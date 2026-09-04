from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from pipeline import (
    Building,
    _bucket,
    _parse_emodata_date,
    _split_values,
    aggregate_labels,
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


if __name__ == "__main__":
    unittest.main()
