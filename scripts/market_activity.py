"""Build an all-owner snapshot of discoverable energy reports since 2025."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.parse

from pipeline import _request_json


START_DATE = date(2025, 1, 1)
PAGE_SIZE = 1000
WORKERS = 4
MAX_PAGES = 300
ENDPOINT = "https://emoweb.dk/emodata/EMOData.svc/GetEnergyLabelInArea"


def month_keys(as_of: date) -> list[str]:
    return [
        f"{year}-{month:02d}"
        for year in range(START_DATE.year, as_of.year + 1)
        for month in range(1, 13)
        if START_DATE <= date(year, month, 1) <= as_of
    ]


def compact_report(row: dict, as_of: date) -> dict | None:
    serial = str(row.get("EnergyLabelSerialIdentifier") or "").strip()
    if not serial.isdigit():
        raise ValueError("Report has no numeric serial identifier")
    raw_date = str(row.get("ValidFrom") or "").strip()
    try:
        valid_from = date.fromisoformat(raw_date[:10])
    except ValueError as error:
        raise ValueError(f"Report {serial} has an invalid ValidFrom") from error
    if valid_from < START_DATE or valid_from > as_of:
        return None
    return {
        "serial": serial,
        "validFrom": valid_from.isoformat(),
        "companyId": str(row.get("SubmitterCompanyIdentifier") or "").strip(),
        "companyName": str(row.get("SubmitterCompanyName") or "").strip(),
        "usage": str(row.get("EnergyLabelTypeUsage") or "").strip() or "Unknown",
        "status": str(row.get("LabelStatus") or "").strip(),
    }


def summarize(reports: list[dict], as_of: date) -> dict:
    months = month_keys(as_of)
    companies = {}
    included = 0
    missing_company = 0
    excluded_statuses = Counter()
    report_ids = set()
    for report in reports:
        if report["serial"] in report_ids:
            raise ValueError("Summary input contains duplicate reports")
        report_ids.add(report["serial"])
        if report["status"] != "VALID":
            excluded_statuses[report["status"] or "Unknown"] += 1
            continue
        included += 1
        # An unidentified firm stays in a visible unknown group, never a named fallback.
        known = bool(report["companyId"] and report["companyName"])
        key = report["companyId"] if known else "__unknown__"
        if not known:
            missing_company += 1
        company = companies.setdefault(key, {
            "id": key,
            "name": report["companyName"] if known else "Firma ikke identificeret",
            "nameAsOf": report["validFrom"],
            "aliases": [],
            "counts": {},
        })
        if known:
            if report["companyName"] not in company["aliases"]:
                company["aliases"].append(report["companyName"])
            if report["validFrom"] >= company["nameAsOf"]:
                company["name"] = report["companyName"]
                company["nameAsOf"] = report["validFrom"]
        month = report["validFrom"][:7]
        if month not in months:
            raise ValueError("Report is outside the requested activity period")
        types = company["counts"].setdefault(month, {})
        types[report["usage"]] = types.get(report["usage"], 0) + 1
    result = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "asOf": as_of.isoformat(),
        "startDate": START_DATE.isoformat(),
        "dateBasis": "ValidFrom",
        "scope": "All ownership and area types; currently discoverable VALID reports",
        "months": months,
        "companies": sorted(companies.values(), key=lambda row: row["name"].casefold()),
        "quality": {
            "includedReports": included,
            "unidentifiedCompanyReports": missing_company,
            "excludedStatuses": dict(excluded_statuses),
            "historicalProductionComplete": False,
        },
    }
    counted = sum(
        count
        for company in result["companies"]
        for types in company["counts"].values()
        for count in types.values()
    )
    if counted != included:
        raise ValueError("Company partitions do not match the report count")
    return result


def collect(as_of: date, request, progress=print) -> dict:
    reports = {}
    scanned = 0
    page_count = 0
    # EMOData caps each geographic request at about 0.60 square degrees.
    tiles = [
        (latitude / 2, longitude, latitude / 2 + 0.5, longitude + 1)
        for latitude in range(108, 118)
        for longitude in range(7, 16)
    ]

    def fetch_tile(tile):
        south, west, north, east = tile
        tile_reports = {}
        fingerprints = set()
        tile_scanned = 0
        for page in range(1, MAX_PAGES + 1):
            query = urllib.parse.urlencode({
                "coordinateX1": south, "coordinateY1": west,
                "coordinateX2": north, "coordinateY2": east,
                "pageNumber": page, "pageSize": PAGE_SIZE,
            })
            payload = request(f"{ENDPOINT}?{query}")
            rows = payload.get("SearchResults")
            status = payload.get("ResponseStatus")
            if not isinstance(status, dict):
                raise RuntimeError(f"Missing geographic response status: {tile}, {page}")
            if rows is None and status.get("Status") in {"NO_RESULT", "NO_RESULTS", "RESULT_NOT_FOUND", "RESULT_EMPTY"}:
                rows = []
            if not isinstance(rows, list):
                raise RuntimeError(
                    f"Unexpected response: tile={tile}, page={page}, status={json.dumps(status)}"
                )
            if rows and status.get("Status") != "RESULT_OK":
                raise RuntimeError(f"EMOData rejected {tile}, {page}: {status.get('Status')}")
            if not rows and status.get("Status") not in {
                "RESULT_OK", "NO_RESULT", "NO_RESULTS", "RESULT_NOT_FOUND", "RESULT_EMPTY",
            }:
                raise RuntimeError(f"Unexpected end of results: {json.dumps(status)}")
            if rows:
                fingerprint = hashlib.sha256(
                    json.dumps(rows, sort_keys=True).encode()
                ).hexdigest()
                if fingerprint in fingerprints:
                    raise RuntimeError("Pagination repeated a page")
                fingerprints.add(fingerprint)
                tile_scanned += len(rows)
                for row in rows:
                    report = compact_report(row, as_of)
                    if report is None:
                        continue
                    current = tile_reports.get(report["serial"])
                    if current is not None and current != report:
                        raise RuntimeError(f"Conflicting report data: {report['serial']}")
                    tile_reports[report["serial"]] = report
            time.sleep(0.4)
            if len(rows) < PAGE_SIZE:
                return tile_scanned, page, list(tile_reports.values())
        raise RuntimeError(f"Tile {tile} exceeded the pagination safety limit")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for index, (tile_scanned, pages, found) in enumerate(pool.map(fetch_tile, tiles), start=1):
            scanned += tile_scanned
            page_count += pages
            for report in found:
                current = reports.get(report["serial"])
                if current is not None and current != report:
                    raise RuntimeError(f"Conflicting report data across tiles: {report['serial']}")
                reports[report["serial"]] = report
            progress(
                f"Completed {index}/{len(tiles)} areas, scanned {scanned} rows, "
                f"found {len(reports)} distinct reports since 2025", flush=True,
            )
    result = summarize(list(reports.values()), as_of)
    result["quality"].update({
        "scannedBuildingRows": scanned, "pages": page_count,
        "tiles": len(tiles), "paginationComplete": True,
        "bounds": {"north": 59, "south": 54, "west": 7, "east": 16},
    })
    if result["quality"]["includedReports"] == 0:
        raise RuntimeError("Nationwide query returned no usable recent reports")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(UTC).date())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    username = os.environ.get("EMODATA_USERNAME")
    password = os.environ.get("EMODATA_PASSWORD")
    if not username or not password:
        raise RuntimeError("EMODATA_USERNAME and EMODATA_PASSWORD are required")
    if args.as_of < START_DATE:
        raise ValueError("Activity snapshot must be on or after 2025-01-01")
    result = collect(args.as_of, lambda url: _request_json(url, username, password))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"asOf": result["asOf"], "quality": result["quality"]}, indent=2))


if __name__ == "__main__":
    main()
