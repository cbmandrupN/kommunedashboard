"""Compare two municipal snapshots without treating data changes as new jobs."""

import argparse
from datetime import date, datetime
import json
from pathlib import Path


SCOPES = {
    "buildings": None,
    "buildings-with-coowners": "coOwnedScope",
    "buildings-from-60": "expandedAreaScope",
    "buildings-from-60-with-coowners": "expandedAreaAndCoOwnedScope",
    "buildings-60-250": "area60To250Scope",
    "buildings-60-250-with-coowners": "area60To250AndCoOwnedScope",
}
FIELDS = (
    "address", "postalCode", "area", "energyLabel", "validTo", "companyName",
    "status", "ownershipType", "primaryOwner",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def index_buildings(payload: dict, as_of: str, cvr: str) -> dict:
    if payload["asOf"] != as_of or payload["municipality"]["cvr"] != cvr:
        raise ValueError(f"Building snapshot differs from dashboard: {cvr}")
    indexed = {}
    for row in payload["buildings"]:
        bfes = sorted(part.strip() for part in row["bfe"].split(",") if part.strip())
        key = "|".join((row["municipalityCode"], ",".join(bfes), row["buildingNumber"]))
        if not bfes or not row["buildingNumber"] or key in indexed:
            raise ValueError(f"Missing or duplicate building identity: {cvr}/{key}")
        indexed[key] = {field: row.get(field, "") for field in FIELDS}
    return indexed


def change_kind(before: dict | None, after: dict | None) -> str:
    if before is None:
        return "added"
    if after is None:
        return "removed"
    if before["energyLabel"] != after["energyLabel"]:
        if not before["energyLabel"]:
            return "found"
        if not after["energyLabel"]:
            return "missing"
        return "replaced"
    if before["status"] == "valid" and after["status"] == "expired":
        return "expired"
    return "updated"


def compare(previous: Path, current: Path) -> dict:
    old_dashboard = read_json(previous / "src" / "data" / "dashboard-data.json")
    dashboard = read_json(current / "src" / "data" / "dashboard-data.json")
    if (date.fromisoformat(old_dashboard["asOf"]) > date.fromisoformat(dashboard["asOf"])
            or datetime.fromisoformat(old_dashboard["generatedAt"])
            >= datetime.fromisoformat(dashboard["generatedAt"])):
        raise ValueError("Previous snapshot must precede the current snapshot")
    result = {
        "schemaVersion": 1,
        "previous": {key: old_dashboard[key] for key in ("asOf", "generatedAt")},
        "current": {key: dashboard[key] for key in ("asOf", "generatedAt")},
        "scopes": {},
    }
    for directory, property_name in SCOPES.items():
        old_scope = old_dashboard.get(property_name) if property_name else old_dashboard
        scope = dashboard.get(property_name) if property_name else dashboard
        if not scope:
            continue
        if not old_scope:
            result["scopes"][directory] = None
            continue
        old_municipalities = {row["cvr"]: row for row in old_scope["municipalities"]}
        if set(old_municipalities) != {row["cvr"] for row in scope["municipalities"]}:
            raise ValueError(f"Municipality coverage changed in {directory}")
        municipalities = []
        for municipality in scope["municipalities"]:
            cvr = municipality["cvr"]
            old_rows = index_buildings(
                read_json(previous / "public" / directory / f"{cvr}.json"),
                old_dashboard["asOf"], cvr,
            )
            rows = index_buildings(
                read_json(current / "public" / directory / f"{cvr}.json"),
                dashboard["asOf"], cvr,
            )
            if (len(old_rows) != old_municipalities[cvr]["eligibleBuildings"]
                    or len(rows) != municipality["eligibleBuildings"]):
                raise ValueError(f"Building count differs from dashboard: {directory}/{cvr}")
            changes = []
            for key in sorted(old_rows.keys() | rows.keys()):
                before, after = old_rows.get(key), rows.get(key)
                if before == after:
                    continue
                changes.append({
                    "key": key,
                    "kind": change_kind(before, after),
                    "before": before,
                    "after": after,
                })
            municipalities.append({
                "cvr": cvr,
                "name": municipality["name"],
                "previousBuildings": len(old_rows),
                "currentBuildings": len(rows),
                "changes": changes,
            })
        result["scopes"][directory] = municipalities
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--current", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.previous, args.current)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({
        "previous": result["previous"]["asOf"],
        "current": result["current"]["asOf"],
        "changes": {
            key: sum(len(row["changes"]) for row in rows) if rows is not None else None
            for key, rows in result["scopes"].items()
        },
    }))


if __name__ == "__main__":
    main()
