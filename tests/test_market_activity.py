from datetime import date
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("market_activity", SCRIPTS / "market_activity.py")
activity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(activity)


def source(serial="123", **values):
    return {
        "EnergyLabelSerialIdentifier": serial,
        "ValidFrom": "2025-01-01", "SubmitterCompanyIdentifier": "600164",
        "SubmitterCompanyName": "Test Firma", "LabelStatus": "VALID",
        "EnergyLabelTypeUsage": "SingleFamily", **values,
    }


class MarketActivityTests(unittest.TestCase):
    def test_exact_start_and_current_month(self):
        as_of = date(2026, 10, 26)
        self.assertEqual(activity.month_keys(as_of)[0], "2025-01")
        self.assertEqual(activity.month_keys(as_of)[-1], "2026-10")
        self.assertEqual(len(activity.month_keys(as_of)), 22)
        self.assertIsNone(activity.compact_report(source(ValidFrom="2024-12-31"), as_of))
        self.assertIsNotNone(activity.compact_report(source(), as_of))
        self.assertIsNone(activity.compact_report(source(ValidFrom="2026-10-27"), as_of))
        with self.assertRaises(ValueError):
            activity.compact_report(source(ValidFrom="invalid"), as_of)

    def test_firm_identity_types_unknown_and_excluded_statuses(self):
        as_of = date(2026, 10, 26)
        records = [
            source("1"),
            source("2", ValidFrom="2026-09-01", SubmitterCompanyName="New name", EnergyLabelTypeUsage="MultiFamily"),
            source("3", SubmitterCompanyIdentifier="", SubmitterCompanyName=""),
            source("4", LabelStatus="CANCELLED"),
        ]
        result = activity.summarize([activity.compact_report(row, as_of) for row in records], as_of)
        self.assertEqual(result["quality"]["includedReports"], 3)
        self.assertEqual(result["quality"]["unidentifiedCompanyReports"], 1)
        self.assertEqual(result["quality"]["excludedStatuses"], {"CANCELLED": 1})
        company = next(row for row in result["companies"] if row["id"] == "600164")
        self.assertEqual(company["name"], "New name")
        self.assertEqual(company["counts"]["2026-09"], {"MultiFamily": 1})
        self.assertFalse(result["quality"]["historicalProductionComplete"])
        self.assertEqual(result["dateBasis"], "ValidFrom")

    @patch.object(activity.time, "sleep")
    def test_pagination_deduplicates_reports_across_buildings(self, _sleep):
        def request(url):
            page = int(parse_qs(urlparse(url).query)["pageNumber"][0])
            return {"ResponseStatus": {"Status": "RESULT_OK"},
                    "SearchResults": [source(), source()] if page == 1 else []}
        result = activity.collect(date(2026, 10, 26), request, lambda *_args, **_kwargs: None)
        self.assertEqual(result["quality"]["scannedBuildingRows"], 2)
        self.assertEqual(result["quality"]["includedReports"], 1)
        self.assertTrue(result["quality"]["paginationComplete"])

    @patch.object(activity.time, "sleep")
    def test_bad_response_does_not_publish_zero_market(self, _sleep):
        with self.assertRaises(RuntimeError):
            activity.collect(date(2026, 10, 26), lambda _: {}, lambda *_args, **_kwargs: None)
        with self.assertRaises(RuntimeError):
            activity.collect(date(2026, 10, 26), lambda _: {
                "ResponseStatus": {"Status": "RESULT_OK"}, "SearchResults": [],
            }, lambda *_args, **_kwargs: None)

    def test_conflicting_duplicate_report_is_not_silently_counted(self):
        row = activity.compact_report(source(), date(2026, 10, 26))
        with self.assertRaises(ValueError):
            activity.summarize([row, row], date(2026, 10, 26))


if __name__ == "__main__":
    unittest.main()
