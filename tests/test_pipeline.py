from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from pipeline import (
    Building,
    _bucket,
    _eligibility_exclusion_reason,
    _parse_emodata_date,
    _split_values,
    aggregate_labels,
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

    def test_building_export_is_valid_xlsx(self) -> None:
        building = Building("1", "101", ("10",), "2", 300)
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
            self.assertLess(
                worksheet.index("<dimension"),
                worksheet.index("<sheetViews>"),
            )


if __name__ == "__main__":
    unittest.main()
