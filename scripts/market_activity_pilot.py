"""Bounded EMOData feasibility sample; never a nationwide market estimate."""

import argparse
import base64
from collections import Counter
from datetime import date, timedelta
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request


BASE_URL = "https://emoweb.dk/emodata/EMOData.svc/"
MAX_REPORTS = 8
MAX_RESPONSE_BYTES = 20_000_000


def previous_month(today: date) -> tuple[date, date]:
    end = today.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def unique_changes(rows: list[dict]) -> list[dict]:
    reports = {}
    for row in rows:
        serial = str(row.get("EntityIdentifier") or "").strip()
        if not serial.isdigit():
            raise ValueError("Change log record has no report identifier")
        reports.setdefault(serial, row)
    return list(reports.values())


def matching_report(rows: list[dict], serial: str) -> dict | None:
    matches = [
        row for row in rows
        if str(row.get("EnergyLabelSerialIdentifier") or "") == serial
    ]
    if not matches:
        return None
    fields = (
        "SubmitterCompanyName", "SubmitterCompanyIdentifier",
        "ValidFrom", "LabelStatusCode", "LabelStatus",
    )
    if any(
        any(row.get(field) != matches[0].get(field) for field in fields)
        for row in matches[1:]
    ):
        raise ValueError(f"Conflicting records for report {serial}")
    return matches[0]


def sample_changes(rows: list[dict], limit: int) -> list[dict]:
    groups = {}
    for row in rows:
        groups.setdefault(str(row.get("ChangeType")), []).append(row)
    sample = []
    while len(sample) < limit and any(groups.values()):
        for group in groups.values():
            if group and len(sample) < limit:
                sample.append(group.pop(0))
    return sample


def request_json(endpoint: str, token: str) -> dict:
    request = urllib.request.Request(
        BASE_URL + endpoint,
        headers={"Authorization": f"Basic {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            content = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"EMOData rejected pilot request: HTTP {error.code}") from error
    if len(content) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Pilot response exceeded its size limit")
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise RuntimeError("EMOData returned an unexpected response")
    time.sleep(0.3)
    return payload


def run_pilot(today: date, request) -> dict:
    start, end = previous_month(today)
    report = {
        "purpose": "Feasibility sample, NOT nationwide monthly activity",
        "month": start.strftime("%Y-%m"),
        "sampleDays": [],
        "reports": [],
        "changeTypeMeaning": "Not inferred from numeric codes",
        "monthlyTotals": None,
    }
    sampled_serials = set()
    for day in (start, end):
        query = urllib.parse.urlencode({
            "fromDate": day.isoformat(),
            "toDate": (day + timedelta(days=1)).isoformat(),
        })
        payload = request(f"GetEnergyLabelChangeLog?{query}")
        rows = payload.get("SearchResults")
        if not isinstance(rows, list):
            raise RuntimeError("Change log has no SearchResults list")
        unique = unique_changes(rows)
        report["sampleDays"].append({
            "fromDate": day.isoformat(),
            "toDate": (day + timedelta(days=1)).isoformat(),
            "responseStatus": payload.get("ResponseStatus"),
            "changeRows": len(rows),
            "uniqueReportIdentifiers": len(unique),
            "changeTypes": dict(Counter(str(row.get("ChangeType")) for row in rows)),
        })
        candidates = [
            row for row in unique
            if str(row["EntityIdentifier"]) not in sampled_serials
        ]
        for change in sample_changes(candidates, MAX_REPORTS // 2):
            serial = str(change["EntityIdentifier"])
            sampled_serials.add(serial)
            sample = {
                "serial": serial,
                "changeType": change.get("ChangeType"),
                "modifiedAt": change.get("LastModificationDateString")
                or change.get("LastModificationDate"),
                "lookupMatched": False,
            }
            parts = [str(change.get(key) or "") for key in (
                "MunicipalityNumber", "PropertyNumber", "BuildingNumber",
            )]
            if not all(re.fullmatch(r"\d+", part) for part in parts):
                sample["lookupIssue"] = "Change record lacks BBR lookup keys"
                report["reports"].append(sample)
                continue
            lookup = request("SearchEnergyLabelBBR/" + "/".join(parts))
            results = lookup.get("SearchResults")
            if not isinstance(results, list):
                raise RuntimeError("BBR lookup has no SearchResults list")
            match = matching_report(results, serial)
            sample["responseStatus"] = lookup.get("ResponseStatus")
            if match:
                sample.update({
                    "lookupMatched": True,
                    "companyName": match.get("SubmitterCompanyName"),
                    "companyIdentifier": match.get("SubmitterCompanyIdentifier"),
                    "validFrom": match.get("ValidFrom"),
                    "labelStatus": match.get("LabelStatus"),
                    "labelStatusCode": match.get("LabelStatusCode"),
                    "usage": match.get("EnergyLabelTypeUsage"),
                    "submissionDatePresentInSearch": bool(match.get("DateOfSubmission")),
                })
            else:
                sample["lookupIssue"] = "Changed report not found in BBR search results"
            report["reports"].append(sample)

    # Prefer one matched and one unmatched record to test both active and replaced reports.
    matched = [row for row in report["reports"] if row["lookupMatched"]]
    unmatched = [row for row in report["reports"] if not row["lookupMatched"]]
    full_samples = (matched[:1] + unmatched[:1])
    if len(full_samples) < 2:
        full_samples = (matched + unmatched)[:2]
    for sample in full_samples:
        payload = request(f"FindEnergyLabelInput/{sample['serial']}")
        wrapper = payload.get("FindEnergyLabelInputResult")
        if not isinstance(wrapper, dict):
            raise RuntimeError("Full input lookup has an unexpected wrapper")
        rows = wrapper.get("EnergyLabels")
        if not isinstance(rows, list):
            raise RuntimeError("Full input lookup has no EnergyLabels list")
        exact = [row for row in rows if str(row.get("EnergyLabelNumber")) == sample["serial"]]
        sample["fullInputMatched"] = bool(exact)
        sample["fullInputResponse"] = wrapper.get("Response")
        if exact:
            row = exact[0]
            sample["dateOfSubmission"] = row.get("DateOfSubmission")
            sample["isUpdated"] = row.get("IsUpdated")
            sample["formerSerial"] = row.get("FormerEnergyLabelSerialIdentifier")
            sample["fullInputValidFrom"] = row.get("ValidFrom")

    report["coverage"] = {
        "sampledReports": len(report["reports"]),
        "matchedInSearch": len(matched),
        "withCompanyName": sum(bool(row.get("companyName")) for row in matched),
        "withCompanyIdentifier": sum(bool(row.get("companyIdentifier")) for row in matched),
        "fullInputLookups": len(full_samples),
        "withSubmissionDate": sum(bool(row.get("dateOfSubmission")) for row in report["reports"]),
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    username = os.environ.get("EMODATA_USERNAME")
    password = os.environ.get("EMODATA_PASSWORD")
    if not username or not password:
        raise RuntimeError("EMODATA_USERNAME and EMODATA_PASSWORD are required")
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    report = run_pilot(args.as_of, lambda endpoint: request_json(endpoint, token))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"month": report["month"], "coverage": report["coverage"]}, indent=2))


if __name__ == "__main__":
    main()
