import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from update_report import change_kind, compare, index_buildings


def building(serial="123", status="valid", **changes):
    return {
        "municipalityCode": "779", "bfe": "100, 200", "buildingNumber": "1",
        "address": "Testvej 1", "postalCode": "7800", "area": 300,
        "energyLabel": serial, "validTo": "2030-01-01" if serial else "",
        "companyName": "Firma A" if serial else "", "status": status,
        "ownershipType": "direct", "primaryOwner": "Test Kommune", **changes,
    }


class UpdateReportTests(unittest.TestCase):
    def test_every_change_kind_and_metadata_are_distinguished(self):
        old = building()
        self.assertEqual(change_kind(None, old), "added")
        self.assertEqual(change_kind(old, None), "removed")
        self.assertEqual(change_kind(building("", "unlabelled"), old), "found")
        self.assertEqual(change_kind(old, building("456")), "replaced")
        self.assertEqual(change_kind(old, building("", "unlabelled")), "missing")
        self.assertEqual(change_kind(old, building(status="expired")), "expired")
        self.assertEqual(change_kind(old, building(companyName="Firma B")), "updated")
        self.assertEqual(change_kind(old, building(area=350)), "updated")

    def test_identity_is_not_address_and_normalizes_bfe_order(self):
        def payload(row):
            return {"asOf": "2026-10-01", "municipality": {"cvr": "12345678"}, "buildings": [row]}
        old = index_buildings(payload(building()), "2026-10-01", "12345678")
        new = index_buildings(payload(building(bfe="200,100", address="Rettet vej")), "2026-10-01", "12345678")
        self.assertEqual(set(old), set(new))
        invalid = payload(building())
        invalid["buildings"].append(building())
        with self.assertRaisesRegex(ValueError, "duplicate"):
            index_buildings(invalid, "2026-10-01", "12345678")
        with self.assertRaisesRegex(ValueError, "snapshot"):
            index_buildings(payload(building()), "2026-10-19", "12345678")

    def test_real_snapshot_flow_and_future_updates(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)

            def write_snapshot(name, day, rows):
                target = root / name
                (target / "src" / "data").mkdir(parents=True)
                (target / "public" / "buildings").mkdir(parents=True)
                dashboard = {
                    "asOf": f"2026-10-{day}", "generatedAt": f"2026-10-{day}T06:00:00+00:00",
                    "municipalities": [{"name": "Test Kommune", "cvr": "12345678", "eligibleBuildings": len(rows)}],
                }
                (target / "src" / "data" / "dashboard-data.json").write_text(json.dumps(dashboard), encoding="utf-8")
                (target / "public" / "buildings" / "12345678.json").write_text(json.dumps({
                    "asOf": dashboard["asOf"], "municipality": {"cvr": "12345678"}, "buildings": rows,
                }), encoding="utf-8")
                return target

            old = write_snapshot("old", "01", [building(), building(buildingNumber="2")])
            current = write_snapshot("current", "19", [building("456"), building("789", buildingNumber="3")])
            report = compare(old, current)
            changes = report["scopes"]["buildings"][0]["changes"]
            self.assertEqual({row["kind"] for row in changes}, {"replaced", "removed", "added"})
            future = write_snapshot("future", "26", [building("456"), building("789", buildingNumber="3")])
            self.assertEqual(compare(current, future)["scopes"]["buildings"][0]["changes"], [])
            with self.assertRaisesRegex(ValueError, "precede"):
                compare(current, old)
            with self.assertRaisesRegex(ValueError, "precede"):
                compare(current, current)
            metadata_path = current / "src" / "data" / "dashboard-data.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["expandedAreaScope"] = copy.deepcopy(metadata)
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            self.assertIsNone(compare(old, current)["scopes"]["buildings-from-60"])
            metadata["municipalities"][0]["eligibleBuildings"] += 1
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "count"):
                compare(old, current)


if __name__ == "__main__":
    unittest.main()
