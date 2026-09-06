from __future__ import annotations

import gzip
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import pipeline
from pipeline import (
    Building,
    _bucket,
    _eligibility_exclusion_reason,
    _parse_emodata_date,
    _split_values,
    aggregate_labels,
    update_from_emodata,
    write_building_data,
    write_building_exports,
)


class PipelineTests(unittest.TestCase):
    def test_bucket_uses_exact_expiry_date(self) -> None:
        as_of = date(2026, 9, 4)
        self.assertEqual(_bucket(date(2026, 9, 3), as_of), "expired")
        self.assertEqual(_bucket(date(2026, 9, 4), as_of), "2026")
        self.assertEqual(_bucket(date(2037, 1, 1), as_of), "2037")
        self.assertIsNone(_bucket(date(2038, 1, 1), as_of))

    def test_split_values_normalizes_multiple_bfes(self) -> None:
        self.assertEqual(_split_values("701124, 6000014;701124"), ("701124", "6000014"))

    def test_inventory_compact_preserves_source_energy_label(self) -> None:
        building = Building(
            "1",
            "101",
            ("10",),
            "2",
            300,
            "Testvej",
            "12A",
            "1234",
            "EM123",
            date(2030, 1, 2),
        )
        self.assertEqual(building.compact()[8:], ["EM123", "2030-01-02"])

    def test_emodata_date_formats(self) -> None:
        self.assertEqual(_parse_emodata_date("04-01-2017"), date(2017, 1, 4))
        self.assertEqual(_parse_emodata_date("2030-12-31"), date(2030, 12, 31))
        self.assertEqual(_parse_emodata_date("/Date(1483488000000)/"), date(2017, 1, 4))

    def test_public_building_eligibility_exclusions(self) -> None:
        self.assertEqual(
            _eligibility_exclusion_reason("930", 400, False, "Fjernvarme"),
            "exemptUseCodeBuildings",
        )
        self.assertEqual(
            _eligibility_exclusion_reason("110", 400, True, "Fjernvarme"),
            "protectedBuildings",
        )
        self.assertEqual(
            _eligibility_exclusion_reason("110", 250, False, "Fjernvarme"),
            "outsidePublicAreaThresholdBuildings",
        )
        self.assertEqual(
            _eligibility_exclusion_reason(
                "110",
                251,
                False,
                "Ingen varmeinstallation",
            ),
            "noHeatingInstallationBuildings",
        )
        self.assertIsNone(
            _eligibility_exclusion_reason("110", 251, False, "Fjernvarme")
        )

    def test_unique_label_can_cover_multiple_buildings(self) -> None:
        first = Building("1", "101", ("10",), "1", 100)
        second = Building("1", "101", ("10",), "2", 200)
        buildings = {
            ("1", "10", "1"): first,
            ("1", "10", "2"): second,
        }
        labels = {
            "EM1": {
                "validTo": date(2027, 1, 1),
                "owners": {
                    "1": {
                        ("1", "10", "1"): first,
                        ("1", "10", "2"): second,
                    }
                },
            }
        }
        result = aggregate_labels(
            municipalities={"1": "Test Kommune"},
            municipality_codes={"1": "101"},
            labels=labels,
            buildings=buildings,
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={
                "sourceRows": 2,
                "includedRows": 2,
                "inventoryBuildings": 2,
                "duplicateBuildingRows": 0,
                "labelsWithMultipleMunicipalOwners": 0,
                "unmatchedEnergyLabels": 0,
            },
        )
        metrics = result["municipalities"][0]["metrics"]
        self.assertEqual(metrics["labels"]["2027"], 1)
        self.assertEqual(metrics["buildings"]["2027"], 2)
        self.assertEqual(metrics["area"]["2027"], 300)
        self.assertEqual(result["municipalities"][0]["eligibleBuildings"], 2)
        self.assertEqual(result["municipalities"][0]["validLabelBuildings"], 2)
        self.assertEqual(result["totalsMissingLabel"]["buildings"], 0)

    def test_expired_and_unlabelled_buildings_are_missing_valid_labels(self) -> None:
        expired = Building("1", "101", ("10",), "1", 100)
        unlabelled = Building("1", "101", ("10",), "2", 200)
        result = aggregate_labels(
            municipalities={"1": "Test Kommune"},
            municipality_codes={"1": "101"},
            labels={
                "EM1": {
                    "validTo": date(2026, 9, 3),
                    "owners": {"1": {("1", "10", "1"): expired}},
                }
            },
            buildings={
                ("1", "10", "1"): expired,
                ("1", "10", "2"): unlabelled,
            },
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={},
        )
        municipality = result["municipalities"][0]
        self.assertEqual(municipality["missingLabel"]["buildings"], 2)
        self.assertEqual(municipality["eligibleBuildings"], 2)
        self.assertEqual(municipality["validLabelBuildings"], 0)
        self.assertEqual(result["totalsMissingLabel"]["buildings"], 2)

    def test_valid_label_beyond_chart_horizon_is_not_missing(self) -> None:
        building = Building("1", "101", ("10",), "1", 100)
        result = aggregate_labels(
            municipalities={"1": "Test Kommune"},
            municipality_codes={"1": "101"},
            labels={
                "EM1": {
                    "validTo": date(2038, 1, 1),
                    "owners": {"1": {("1", "10", "1"): building}},
                }
            },
            buildings={("1", "10", "1"): building},
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={},
        )
        municipality = result["municipalities"][0]
        self.assertEqual(result["totalsMissingLabel"]["buildings"], 0)
        self.assertEqual(municipality["eligibleBuildings"], 1)
        self.assertEqual(municipality["validLabelBuildings"], 1)

    def test_emodata_update_uses_source_label_when_no_match_is_returned(self) -> None:
        source_labelled = Building(
            "1",
            "101",
            ("10",),
            "1",
            100,
            source_energy_label="EM-SOURCE",
            source_valid_to=date(2030, 1, 1),
        )
        unlabelled = Building("1", "101", ("20",), "2", 200)
        inventory = {
            "quality": {},
            "municipalities": [
                {"cvr": "1", "name": "Test Kommune", "municipalityCode": "101"}
            ],
            "buildings": [source_labelled.compact(), unlabelled.compact()],
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            inventory_path = root / "inventory.json.gz"
            with gzip.open(inventory_path, "wt", encoding="utf-8") as output:
                json.dump(inventory, output)
            with (
                mock.patch.dict(
                    "os.environ",
                    {"EMODATA_USERNAME": "user", "EMODATA_PASSWORD": "password"},
                ),
                mock.patch.object(
                    pipeline,
                    "_request_json",
                    return_value={"EnergyLabels": []},
                ),
                mock.patch.object(pipeline, "write_dashboard"),
            ):
                result = update_from_emodata(
                    inventory_path=inventory_path,
                    dashboard_path=root / "dashboard.json",
                    as_of=date(2026, 9, 5),
                )
        municipality = result["municipalities"][0]
        self.assertEqual(municipality["validLabelBuildings"], 1)
        self.assertEqual(municipality["unlabelled"]["buildings"], 1)
        self.assertEqual(result["quality"]["sourceLabelFallbackBuildings"], 1)

    def test_emodata_report_link_is_added_to_building_data(self) -> None:
        building = Building("1", "101", ("10",), "1", 300)
        inventory = {
            "quality": {},
            "municipalities": [
                {"cvr": "1", "name": "Test Kommune", "municipalityCode": "101"}
            ],
            "buildings": [building.compact()],
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            inventory_path = root / "inventory.json.gz"
            building_data_dir = root / "buildings"
            with gzip.open(inventory_path, "wt", encoding="utf-8") as output:
                json.dump(inventory, output)
            with (
                mock.patch.dict(
                    "os.environ",
                    {"EMODATA_USERNAME": "user", "EMODATA_PASSWORD": "password"},
                ),
                mock.patch.object(
                    pipeline,
                    "_request_json",
                    return_value={
                        "EnergyLabels": [
                            {
                                "EnergyLabelSerialIdentifier": "311199190",
                                "BFENumber": "10",
                                "BuildingNumbers": "1",
                                "ValidTo": "2030-01-01",
                                "DEMOLink": (
                                    "http://tjekenergimaerke.emoweb.dk/"
                                    "Report/311199190"
                                ),
                            }
                        ]
                    },
                ),
                mock.patch.object(pipeline, "write_dashboard"),
            ):
                update_from_emodata(
                    inventory_path=inventory_path,
                    dashboard_path=root / "dashboard.json",
                    building_data_dir=building_data_dir,
                    as_of=date(2026, 9, 5),
                )
            payload = json.loads(
                (building_data_dir / "1.json").read_text(encoding="utf-8")
            )
        self.assertEqual(
            payload["buildings"][0]["reportUrl"],
            "https://tjekenergimaerke.emoweb.dk/Report/311199190",
        )

    def test_building_export_is_valid_xlsx(self) -> None:
        building = Building(
            "1",
            "101",
            ("10",),
            "2",
            300,
            "Testvej",
            "12A",
            "1234",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            export_dir = Path(temporary_directory)
            write_building_exports(
                export_dir=export_dir,
                municipalities={"1": "Test Kommune"},
                buildings={("1", "10", "2"): building},
                labels={},
                as_of=date(2026, 9, 4),
            )
            workbook_path = export_dir / "1.xlsx"
            self.assertTrue(workbook_path.exists())
            with zipfile.ZipFile(workbook_path) as workbook:
                worksheet = workbook.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn("Test Kommune", worksheet)
            self.assertIn("Mangler energimærke", worksheet)
            self.assertIn("BFE-nummer", worksheet)
            self.assertIn("Adresse", worksheet)
            self.assertIn("Testvej 12A", worksheet)
            self.assertIn("Postnr.", worksheet)
            self.assertIn("1234", worksheet)
            self.assertLess(
                worksheet.index("<dimension"),
                worksheet.index("<sheetViews>"),
            )

    def test_building_data_contains_browser_fields_and_statuses(self) -> None:
        as_of = date(2026, 9, 4)
        expired = Building(
            "1", "101", ("10",), "1", 200, "Gammel Vej", "1", "1234"
        )
        unlabelled = Building(
            "1", "101", ("20",), "2", 300, "Ny Vej", "2A", "1234"
        )
        labels = {
            "EM1": {
                "validTo": date(2026, 9, 3),
                "reportUrl": "https://tjekenergimaerke.emoweb.dk/report/EM1",
                "owners": {"1": {("1", "10", "1"): expired}},
            }
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            data_dir = Path(temporary_directory)
            write_building_data(
                data_dir=data_dir,
                municipalities={"1": "Test Kommune"},
                buildings={
                    ("1", "10", "1"): expired,
                    ("1", "20", "2"): unlabelled,
                },
                labels=labels,
                as_of=as_of,
            )
            payload = json.loads((data_dir / "1.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["municipality"]["name"], "Test Kommune")
        self.assertEqual(len(payload["buildings"]), 2)
        self.assertEqual(payload["buildings"][0]["status"], "unlabelled")
        self.assertEqual(payload["buildings"][0]["address"], "Ny Vej 2A")
        self.assertEqual(payload["buildings"][1]["status"], "expired")
        self.assertEqual(payload["buildings"][1]["energyLabel"], "EM1")
        self.assertEqual(
            payload["buildings"][1]["reportUrl"],
            "https://tjekenergimaerke.emoweb.dk/report/EM1",
        )


if __name__ == "__main__":
    unittest.main()
