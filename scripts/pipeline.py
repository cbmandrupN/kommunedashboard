from __future__ import annotations

import argparse
import base64
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EMODATA_URL = (
    "https://emoweb.dk/emodata/EMOData.svc/"
    "SearchEnergyLabelsMunicipality/{municipality}"
)
YEARS = tuple(str(year) for year in range(2026, 2038))
BUCKETS = ("expired", *YEARS)
PUBLIC_PERIODIC_AREA_THRESHOLD = 250
EXEMPT_USE_CODES = frozenset(
    {
        *(str(code) for code in range(211, 220)),
        "221",
        "222",
        "223",
        "229",
        "231",
        "232",
        "233",
        "234",
        "239",
        "414",
        "510",
        "540",
        "585",
        "910",
        "920",
        "930",
    }
)


@dataclass(frozen=True)
class Building:
    cvr: str
    municipality_code: str
    bfes: tuple[str, ...]
    building_number: str
    area: int
    street: str = ""
    house_number: str = ""
    postal_code: str = ""
    source_energy_label: str = ""
    source_valid_to: date | None = None

    def compact(self) -> list[Any]:
        return [
            self.cvr,
            self.municipality_code,
            list(self.bfes),
            self.building_number,
            self.area,
            self.street,
            self.house_number,
            self.postal_code,
            self.source_energy_label,
            self.source_valid_to.isoformat() if self.source_valid_to else "",
        ]


def _column_index(reference: str) -> int:
    column = 0
    for char in re.match(r"[A-Z]+", reference).group():
        column = column * 26 + ord(char) - 64
    return column - 1


def iter_xlsx_rows(path: Path) -> Iterable[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(node.text or "" for node in item.iter(SHEET_NS + "t"))
                for item in root.findall(SHEET_NS + "si")
            ]

        headers: list[str] | None = None
        with archive.open("xl/worksheets/sheet1.xml") as worksheet:
            for _, element in ET.iterparse(worksheet, events=("end",)):
                if element.tag != SHEET_NS + "row":
                    continue
                values: dict[int, str] = {}
                for cell in element.findall(SHEET_NS + "c"):
                    value = cell.find(SHEET_NS + "v")
                    if value is None:
                        continue
                    parsed = (
                        shared[int(value.text)]
                        if cell.get("t") == "s"
                        else value.text or ""
                    )
                    values[_column_index(cell.get("r", "A1"))] = parsed

                if headers is None:
                    width = max(values, default=-1) + 1
                    headers = [values.get(index, "") for index in range(width)]
                else:
                    yield {
                        header: values.get(index, "")
                        for index, header in enumerate(headers)
                    }
                element.clear()


def _find_column(row: dict[str, str], expected: str) -> str:
    normalized = expected.lower().replace("ø", "o").replace("æ", "ae")
    for key in row:
        candidate = (
            key.lower()
            .replace("ø", "o")
            .replace("æ", "ae")
            .replace("\ufffd", "")
        )
        if normalized == candidate or normalized in candidate:
            return key
    raise KeyError(f"Missing required column: {expected}")


def _excel_date(value: str) -> date:
    return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()


def _parse_emodata_date(value: str) -> date:
    stripped = value.strip()
    milliseconds = re.fullmatch(r"/Date\((\d+)(?:[+-]\d+)?\)/", stripped)
    if milliseconds:
        return datetime.fromtimestamp(
            int(milliseconds.group(1)) / 1000,
            tz=UTC,
        ).date()
    for pattern in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(stripped[:10], pattern).date()
        except ValueError:
            pass
    return datetime.fromisoformat(stripped.replace("Z", "+00:00")).date()


def _integer(value: str | None) -> int:
    if not value:
        return 0
    return round(float(value))


def _split_values(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(
        dict.fromkeys(
            part.strip()
            for part in re.split(r"[,;]", value)
            if part.strip()
        )
    )


def _empty_metrics() -> dict[str, dict[str, int]]:
    return {
        "labels": {bucket: 0 for bucket in BUCKETS},
        "buildings": {bucket: 0 for bucket in BUCKETS},
        "area": {bucket: 0 for bucket in BUCKETS},
    }


def _bucket(valid_to: date, as_of: date) -> str | None:
    if valid_to < as_of:
        return "expired"
    year = str(valid_to.year)
    return year if year in YEARS else None


def _xlsx_column(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _xlsx_cell(reference: str, value: str | int) -> str:
    if isinstance(value, int):
        return f'<c r="{reference}"><v>{value}</v></c>'
    return (
        f'<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">'
        f"{escape(value)}</t></is></c>"
    )


def _write_xlsx(path: Path, rows: list[list[str | int]]) -> None:
    worksheet_rows = []
    for row_number, values in enumerate(rows, start=1):
        cells = "".join(
            _xlsx_cell(f"{_xlsx_column(column)}{row_number}", value)
            for column, value in enumerate(values, start=1)
        )
        worksheet_rows.append(f'<row r="{row_number}">{cells}</row>')
    last_column = _xlsx_column(max(len(row) for row in rows))
    last_row = len(rows)
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="A1:{last_column}{last_row}"/>'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        "</sheetView></sheetViews>"
        "<sheetData>"
        + "".join(worksheet_rows)
        + "</sheetData>"
        f'<autoFilter ref="A1:{last_column}{last_row}"/>'
        "</worksheet>"
    )
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Bygninger" sheetId="1" r:id="rId1"/></sheets>'
            "</workbook>"
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>"
        ),
        "xl/worksheets/sheet1.xml": worksheet,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        for filename, content in files.items():
            workbook.writestr(filename, content.encode("utf-8"))


def write_building_exports(
    export_dir: Path,
    municipalities: dict[str, str],
    buildings: dict[tuple[str, str, str], Building],
    labels: dict[str, dict[str, Any]],
    as_of: date,
) -> None:
    records_by_cvr = _building_records_by_cvr(buildings, labels, as_of)
    export_dir.mkdir(parents=True, exist_ok=True)
    for cvr, municipality_name in municipalities.items():
        data_rows = [
            [
                municipality_name,
                cvr,
                record["municipalityCode"],
                record["address"],
                record["postalCode"],
                record["bfe"],
                record["buildingNumber"],
                record["area"],
                record["energyLabel"],
                record["validTo"],
                {
                    "unlabelled": "Mangler energimærke",
                    "expired": "Udløbet",
                    "valid": "Gyldigt",
                }[record["status"]],
                "Nej" if record["status"] == "valid" else "Ja",
            ]
            for record in records_by_cvr.get(cvr, [])
        ]
        _write_xlsx(
            export_dir / f"{cvr}.xlsx",
            [
                [
                    "Kommune",
                    "CVR",
                    "Geografisk kommunekode",
                    "Adresse",
                    "Postnr.",
                    "BFE-nummer",
                    "Bygningsnummer",
                    "Areal (m²)",
                    "EM-nummer",
                    "Gyldig til",
                    "Status",
                    "Mangler gyldigt mærke",
                ],
                *data_rows,
            ],
        )


def _building_records_by_cvr(
    buildings: dict[tuple[str, str, str], Building],
    labels: dict[str, dict[str, Any]],
    as_of: date,
) -> dict[str, list[dict[str, str | int]]]:
    latest_by_building: dict[tuple[str, str, str], tuple[str, date]] = {}
    for serial, entry in labels.items():
        valid_to = entry["validTo"]
        for owner_buildings in entry["owners"].values():
            for key in owner_buildings:
                current = latest_by_building.get(key)
                if current is None or valid_to > current[1]:
                    latest_by_building[key] = (serial, valid_to)

    records_by_cvr: dict[str, list[dict[str, str | int]]] = defaultdict(list)
    for key, building in buildings.items():
        label = latest_by_building.get(key)
        serial = label[0] if label else ""
        valid_to = label[1] if label else None
        status = (
            "unlabelled"
            if valid_to is None
            else "expired"
            if valid_to < as_of
            else "valid"
        )
        records_by_cvr[building.cvr].append(
            {
                "municipalityCode": building.municipality_code,
                "address": " ".join(
                    part for part in (building.street, building.house_number) if part
                ),
                "postalCode": (
                    "" if building.postal_code == "0" else building.postal_code
                ),
                "bfe": ", ".join(building.bfes),
                "buildingNumber": building.building_number,
                "area": building.area,
                "energyLabel": serial,
                "validTo": valid_to.isoformat() if valid_to else "",
                "status": status,
            }
        )
    status_order = {"unlabelled": 0, "expired": 1, "valid": 2}
    for records in records_by_cvr.values():
        records.sort(
            key=lambda record: (
                status_order[str(record["status"])],
                str(record["validTo"]) or "0000",
                str(record["address"]),
                str(record["bfe"]),
                str(record["buildingNumber"]),
            )
        )
    return records_by_cvr


def write_building_data(
    data_dir: Path,
    municipalities: dict[str, str],
    buildings: dict[tuple[str, str, str], Building],
    labels: dict[str, dict[str, Any]],
    as_of: date,
) -> None:
    records_by_cvr = _building_records_by_cvr(buildings, labels, as_of)
    data_dir.mkdir(parents=True, exist_ok=True)
    for cvr, municipality_name in municipalities.items():
        payload = {
            "schemaVersion": 1,
            "asOf": as_of.isoformat(),
            "municipality": {"name": municipality_name, "cvr": cvr},
            "buildings": records_by_cvr.get(cvr, []),
        }
        (data_dir / f"{cvr}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )


def _eligibility_exclusion_reason(
    use_code: str,
    area: int,
    protected: bool,
    heating: str,
) -> str | None:
    if use_code in EXEMPT_USE_CODES:
        return "exemptUseCodeBuildings"
    if protected:
        return "protectedBuildings"
    if area <= PUBLIC_PERIODIC_AREA_THRESHOLD:
        return "outsidePublicAreaThresholdBuildings"
    if heating.strip().casefold() == "ingen varmeinstallation":
        return "noHeatingInstallationBuildings"
    return None


def load_municipalities(path: Path) -> dict[str, str]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    result = {str(row["cvr"]): str(row["name"]) for row in rows}
    if len(result) != 98:
        raise ValueError(f"Expected 98 municipality CVRs, found {len(result)}")
    return result


def import_workbook(
    workbook: Path,
    municipalities_path: Path,
    inventory_path: Path,
    dashboard_path: Path,
    as_of: date,
    export_dir: Path | None = None,
    building_data_dir: Path | None = None,
) -> dict[str, Any]:
    municipalities = load_municipalities(municipalities_path)
    municipality_code_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    buildings: dict[tuple[str, str, str], Building] = {}
    labels: dict[str, dict[str, Any]] = {}
    source_building_keys: set[tuple[str, str, str]] = set()
    exclusion_counts: Counter[str] = Counter()
    rows_seen = 0
    municipal_rows = 0
    included_rows = 0
    duplicate_buildings = 0
    labels_with_multiple_owners: set[str] = set()

    for row in iter_xlsx_rows(workbook):
        rows_seen += 1
        cvr = row.get(_find_column(row, "CVR"), "").strip()
        if cvr not in municipalities:
            continue

        municipal_rows += 1
        municipality_code = row.get(_find_column(row, "Kommunenr"), "").strip()
        sfe = row.get(_find_column(row, "SFE-nummer"), "").strip()
        building_number = row.get(_find_column(row, "Bygningsnummer"), "").strip()
        bfe_values = _split_values(row.get(_find_column(row, "BFE-nummer")))
        area = _integer(row.get(_find_column(row, "Boligareal"))) + _integer(
            row.get(_find_column(row, "Erhvervsareal"))
        )
        street = row.get(_find_column(row, "Vejnavn"), "").strip()
        house_number = row.get(_find_column(row, "Husnr."), "").strip()
        postal_code = row.get(_find_column(row, "Postnr."), "").strip()
        energy_label = row.get(_find_column(row, "EM-nr"), "").strip()
        valid_to_raw = row.get(_find_column(row, "Gyldig til"), "").strip()
        source_valid_to = _excel_date(valid_to_raw) if valid_to_raw else None
        building_key = (cvr, sfe or "|".join(bfe_values), building_number)
        first_source_occurrence = building_key not in source_building_keys
        source_building_keys.add(building_key)
        municipality_code_counts[cvr][municipality_code] += 1

        use_code = row.get(_find_column(row, "Anvendelskode"), "").strip()
        protected_value = row.get(_find_column(row, "Fredet bygning"), "").strip()
        protected = protected_value.casefold() not in {"", "nej"}
        heating = row.get(_find_column(row, "Varmeforsyning"), "").strip()
        exclusion_reason = _eligibility_exclusion_reason(
            use_code,
            area,
            protected,
            heating,
        )
        if exclusion_reason:
            if first_source_occurrence:
                exclusion_counts[exclusion_reason] += 1
            continue

        included_rows += 1
        building = Building(
            cvr,
            municipality_code,
            bfe_values,
            building_number,
            area,
            street,
            house_number,
            postal_code,
            energy_label,
            source_valid_to,
        )
        if building_key in buildings:
            duplicate_buildings += 1
        else:
            buildings[building_key] = building

        if not energy_label or source_valid_to is None:
            continue

        entry = labels.setdefault(
            energy_label,
            {"validTo": source_valid_to, "owners": defaultdict(dict)},
        )
        if entry["validTo"] != source_valid_to:
            entry["validTo"] = max(entry["validTo"], source_valid_to)
        owner_buildings = entry["owners"][cvr]
        owner_buildings[building_key] = building
        if len(entry["owners"]) > 1:
            labels_with_multiple_owners.add(energy_label)

    missing_cvrs = sorted(set(municipalities) - set(municipality_code_counts))
    if missing_cvrs:
        raise ValueError(f"Workbook is missing municipality CVRs: {missing_cvrs}")
    primary_municipality_codes = {
        cvr: max(counts, key=counts.get)
        for cvr, counts in municipality_code_counts.items()
    }

    inventory = {
        "schemaVersion": 4,
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": workbook.name,
        "quality": {
            "sourceRows": rows_seen,
            "municipalityOwnedRows": municipal_rows,
            "municipalInventoryBuildings": len(source_building_keys),
            "includedRows": included_rows,
            "inventoryBuildings": len(buildings),
            "duplicateBuildingRows": duplicate_buildings,
            **exclusion_counts,
        },
        "municipalities": [
            {
                "name": municipalities[cvr],
                "cvr": cvr,
                "municipalityCode": primary_municipality_codes[cvr],
                "municipalityCodes": sorted(municipality_code_counts[cvr]),
            }
            for cvr in sorted(municipalities)
        ],
        "buildings": [
            building.compact()
            for building in sorted(
                buildings.values(),
                key=lambda item: (
                    item.cvr,
                    item.municipality_code,
                    item.bfes,
                    item.building_number,
                ),
            )
        ],
    }
    inventory_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(inventory_path, "wt", encoding="utf-8") as output:
        json.dump(inventory, output, ensure_ascii=False, separators=(",", ":"))

    dashboard = aggregate_labels(
        municipalities=municipalities,
        municipality_codes=primary_municipality_codes,
        labels=labels,
        buildings=buildings,
        as_of=as_of,
        source_name=re.sub(r"^[0-9a-fA-F-]{36}-", "", workbook.name),
        quality={
            "sourceRows": rows_seen,
            "municipalityOwnedRows": municipal_rows,
            "municipalInventoryBuildings": len(source_building_keys),
            "includedRows": included_rows,
            "inventoryBuildings": len(buildings),
            "duplicateBuildingRows": duplicate_buildings,
            **exclusion_counts,
            "labelsWithMultipleMunicipalOwners": len(labels_with_multiple_owners),
            "unmatchedEnergyLabels": 0,
        },
    )
    if export_dir:
        write_building_exports(export_dir, municipalities, buildings, labels, as_of)
    if building_data_dir:
        write_building_data(
            building_data_dir,
            municipalities,
            buildings,
            labels,
            as_of,
        )
    write_dashboard(dashboard_path, dashboard)
    return dashboard


def aggregate_labels(
    municipalities: dict[str, str],
    municipality_codes: dict[str, str],
    labels: dict[str, dict[str, Any]],
    buildings: dict[tuple[str, str, str], Building],
    as_of: date,
    source_name: str,
    quality: dict[str, int],
) -> dict[str, Any]:
    rows: dict[str, dict[str, Any]] = {
        cvr: {
            "name": name,
            "cvr": cvr,
            "municipalityCode": municipality_codes[cvr],
            "metrics": _empty_metrics(),
            "unlabelled": {"buildings": 0, "area": 0},
            "missingLabel": {"buildings": 0, "area": 0},
            "eligibleBuildings": 0,
            "validLabelBuildings": 0,
        }
        for cvr, name in municipalities.items()
    }
    labelled_building_keys: set[tuple[str, str, str]] = set()

    for entry in labels.values():
        bucket = _bucket(entry["validTo"], as_of)
        for cvr, owner_buildings in entry["owners"].items():
            labelled_building_keys.update(owner_buildings)
            if bucket is None:
                continue
            municipality = rows[cvr]
            municipality["metrics"]["labels"][bucket] += 1
            municipality["metrics"]["buildings"][bucket] += len(owner_buildings)
            municipality["metrics"]["area"][bucket] += sum(
                building.area for building in owner_buildings.values()
            )

    for key, building in buildings.items():
        rows[building.cvr]["eligibleBuildings"] += 1
        if key not in labelled_building_keys:
            rows[building.cvr]["unlabelled"]["buildings"] += 1
            rows[building.cvr]["unlabelled"]["area"] += building.area

    totals = _empty_metrics()
    totals_missing_label = {"buildings": 0, "area": 0}
    for municipality in rows.values():
        municipality["missingLabel"]["buildings"] = (
            municipality["unlabelled"]["buildings"]
            + municipality["metrics"]["buildings"]["expired"]
        )
        municipality["missingLabel"]["area"] = (
            municipality["unlabelled"]["area"]
            + municipality["metrics"]["area"]["expired"]
        )
        municipality["validLabelBuildings"] = (
            municipality["eligibleBuildings"]
            - municipality["missingLabel"]["buildings"]
        )
        for metric in totals_missing_label:
            totals_missing_label[metric] += municipality["missingLabel"][metric]
        for metric in totals:
            for bucket in BUCKETS:
                totals[metric][bucket] += municipality["metrics"][metric][bucket]

    municipalities_with_labels = sum(
        any(row["metrics"]["labels"].values()) for row in rows.values()
    )
    return {
        "schemaVersion": 2,
        "generatedAt": datetime.now(UTC).isoformat(),
        "asOf": as_of.isoformat(),
        "source": source_name,
        "years": list(YEARS),
        "totals": totals,
        "totalsMissingLabel": totals_missing_label,
        "municipalities": sorted(rows.values(), key=lambda row: row["name"]),
        "quality": {
            **quality,
            "municipalityCount": len(rows),
            "municipalitiesWithLabels": municipalities_with_labels,
            "uniqueEnergyLabels": len(labels),
        },
    }


def write_dashboard(path: Path, dashboard: dict[str, Any]) -> None:
    if dashboard["quality"]["municipalityCount"] != 98:
        raise ValueError("Refusing to write dashboard without all 98 municipalities")
    if dashboard["quality"]["uniqueEnergyLabels"] < 1000:
        raise ValueError("Refusing to write an implausibly small energy-label dataset")
    if dashboard["quality"]["municipalitiesWithLabels"] < 90:
        raise ValueError(
            "Refusing to write data with fewer than 90 municipalities containing labels"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(dashboard, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _request_json(url: str, username: str, password: str) -> dict[str, Any]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Basic {token}", "Accept": "application/json"},
    )
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504}:
                raise RuntimeError(
                    f"EMOData rejected the request with HTTP {error.code}"
                ) from error
            last_error = error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
        if attempt < 4:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"EMOData request failed after retries: {last_error}")


def update_from_emodata(
    inventory_path: Path,
    dashboard_path: Path,
    as_of: date,
    export_dir: Path | None = None,
    building_data_dir: Path | None = None,
) -> dict[str, Any]:
    username = os.environ.get("EMODATA_USERNAME")
    password = os.environ.get("EMODATA_PASSWORD")
    if not username or not password:
        raise RuntimeError("EMODATA_USERNAME and EMODATA_PASSWORD are required")

    with gzip.open(inventory_path, "rt", encoding="utf-8") as source:
        inventory = json.load(source)

    municipalities = {
        row["cvr"]: row["name"] for row in inventory["municipalities"]
    }
    municipality_codes = {
        row["cvr"]: row["municipalityCode"]
        for row in inventory["municipalities"]
    }
    buildings: dict[tuple[str, str, str], Building] = {}
    by_bfe: dict[tuple[str, str], list[tuple[tuple[str, str, str], Building]]] = defaultdict(list)
    for compact in inventory["buildings"]:
        building = Building(
            cvr=compact[0],
            municipality_code=compact[1],
            bfes=tuple(compact[2]),
            building_number=compact[3],
            area=int(compact[4]),
            street=compact[5],
            house_number=compact[6],
            postal_code=compact[7],
            source_energy_label=str(compact[8]) if len(compact) > 8 else "",
            source_valid_to=(
                date.fromisoformat(compact[9])
                if len(compact) > 9 and compact[9]
                else None
            ),
        )
        key = (building.cvr, "|".join(building.bfes), building.building_number)
        buildings[key] = building
        for bfe in building.bfes:
            by_bfe[(building.municipality_code, bfe)].append((key, building))

    latest_by_building: dict[
        tuple[str, str, str],
        tuple[str, date, Building],
    ] = {
        key: (building.source_energy_label, building.source_valid_to, building)
        for key, building in buildings.items()
        if building.source_energy_label and building.source_valid_to
    }
    source_label_building_keys = set(latest_by_building)
    emodata_matched_building_keys: set[tuple[str, str, str]] = set()
    unmatched = 0
    malformed = 0
    returned = 0
    matched_candidates = 0
    geographic_codes = sorted(
        {building.municipality_code for building in buildings.values()}
    )
    for municipality_code in geographic_codes:
        payload = _request_json(
            EMODATA_URL.format(municipality=municipality_code),
            username,
            password,
        )
        time.sleep(0.25)
        energy_labels = payload.get("EnergyLabels")
        if not isinstance(energy_labels, list):
            raise RuntimeError(
                f"Unexpected EMOData schema for municipality {municipality_code}"
            )
        for item in energy_labels:
            returned += 1
            serial = str(item.get("EnergyLabelSerialIdentifier") or "").strip()
            bfe = str(item.get("BFENumber") or "").strip()
            valid_to_raw = str(item.get("ValidTo") or "").strip()
            if not serial or not bfe or not valid_to_raw:
                malformed += 1
                continue
            try:
                valid_to = _parse_emodata_date(valid_to_raw)
            except (ValueError, OverflowError):
                malformed += 1
                continue

            candidates = by_bfe.get((municipality_code, bfe), [])
            building_numbers = set(
                _split_values(str(item.get("BuildingNumbers") or ""))
            )
            if building_numbers:
                exact = [
                    pair
                    for pair in candidates
                    if pair[1].building_number in building_numbers
                ]
                if exact:
                    candidates = exact
            if not candidates:
                unmatched += 1
                continue

            matched_candidates += 1
            for key, building in candidates:
                emodata_matched_building_keys.add(key)
                current = latest_by_building.get(key)
                if current is None or valid_to > current[1]:
                    latest_by_building[key] = (serial, valid_to, building)

    labels: dict[str, dict[str, Any]] = {}
    for key, (serial, valid_to, building) in latest_by_building.items():
        entry = labels.setdefault(
            serial,
            {"validTo": valid_to, "owners": defaultdict(dict)},
        )
        entry["validTo"] = max(entry["validTo"], valid_to)
        entry["owners"][building.cvr][key] = building

    dashboard = aggregate_labels(
        municipalities=municipalities,
        municipality_codes=municipality_codes,
        labels=labels,
        buildings=buildings,
        as_of=as_of,
        source_name="EMOData",
        quality={
            **inventory.get("quality", {}),
            "includedRows": len(buildings),
            "inventoryBuildings": len(buildings),
            "labelsWithMultipleMunicipalOwners": sum(
                len(entry["owners"]) > 1 for entry in labels.values()
            ),
            "geographicEnergyLabelsReturned": returned,
            "matchedEnergyLabelCandidates": matched_candidates,
            "sourceLabelFallbackBuildings": len(
                source_label_building_keys - emodata_matched_building_keys
            ),
            "unmatchedGeographicEnergyLabels": unmatched,
            "malformedEnergyLabels": malformed,
        },
    )
    if export_dir:
        write_building_exports(export_dir, municipalities, buildings, labels, as_of)
    if building_data_dir:
        write_building_data(
            building_data_dir,
            municipalities,
            buildings,
            labels,
            as_of,
        )
    write_dashboard(dashboard_path, dashboard)
    return dashboard


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate municipality dashboard data")
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    subparsers = parser.add_subparsers(dest="command", required=True)

    workbook = subparsers.add_parser("import-workbook")
    workbook.add_argument("workbook", type=Path)
    workbook.add_argument("--municipalities", type=Path, required=True)
    workbook.add_argument("--inventory", type=Path, required=True)
    workbook.add_argument("--dashboard", type=Path, required=True)
    workbook.add_argument("--exports", type=Path)
    workbook.add_argument("--building-data", type=Path)

    emodata = subparsers.add_parser("update-emodata")
    emodata.add_argument("--inventory", type=Path, required=True)
    emodata.add_argument("--dashboard", type=Path, required=True)
    emodata.add_argument("--exports", type=Path)
    emodata.add_argument("--building-data", type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.command == "import-workbook":
        dashboard = import_workbook(
            args.workbook,
            args.municipalities,
            args.inventory,
            args.dashboard,
            args.as_of,
            args.exports,
            args.building_data,
        )
    else:
        dashboard = update_from_emodata(
            args.inventory,
            args.dashboard,
            args.as_of,
            args.exports,
            args.building_data,
        )
    print(
        json.dumps(
            {
                "generatedAt": dashboard["generatedAt"],
                "source": dashboard["source"],
                "quality": dashboard["quality"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
