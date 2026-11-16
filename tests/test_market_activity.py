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
        self.assertEqual(result["quality"]["scannedBuildingRows"], 180)
        self.assertEqual(result["quality"]["includedReports"], 1)
        self.assertTrue(result["quality"]["paginationComplete"])
        self.assertEqual(result["quality"]["tiles"], 90)

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

    @patch.object(activity.time, "sleep")
    def test_unspecified_error_retries_same_page_without_double_counting(self, sleep):
        requests = {}
        messages = []

        def request(url):
            requests[url] = requests.get(url, 0) + 1
            page = int(parse_qs(urlparse(url).query)["pageNumber"][0])
            if page == 2 and requests[url] <= 2:
                return {"ResponseStatus": {"Status": "UNSPECIFIED_ERROR", "StatusCode": 0},
                        "SearchResults": None}
            return {"ResponseStatus": {"Status": "RESULT_OK"},
                    "SearchResults": [source()] if page == 1 else []}

        with patch.object(activity, "PAGE_SIZE", 1), patch.object(activity, "WORKERS", 1):
            result = activity.collect(date(2026, 10, 26), request,
                                      lambda message, **_kwargs: messages.append(message))
        self.assertEqual(result["quality"]["includedReports"], 1)
        self.assertEqual(result["quality"]["scannedBuildingRows"], 90)
        self.assertEqual(result["quality"]["pages"], 180)
        self.assertEqual(sum("retrying" in message for message in messages), 180)
        self.assertTrue(all(attempts == (3 if "pageNumber=2" in url else 1)
                            for url, attempts in requests.items()))
        sleep.assert_any_call(5)
        sleep.assert_any_call(10)

    @patch.object(activity.time, "sleep")
    def test_persistent_unspecified_error_aborts_after_bounded_retries(self, _sleep):
        requests = {}

        def request(url):
            requests[url] = requests.get(url, 0) + 1
            return {"ResponseStatus": {"Status": "UNSPECIFIED_ERROR"}, "SearchResults": []}

        with patch.object(activity, "WORKERS", 1), self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
            activity.collect(date(2026, 10, 26), request, lambda *_args, **_kwargs: None)
        self.assertTrue(requests)
        self.assertTrue(all(attempts == 3 for attempts in requests.values()))

    @patch.object(activity.time, "sleep")
    def test_authentication_error_is_not_retried_as_transient(self, _sleep):
        requests = {}

        def request(url):
            requests[url] = requests.get(url, 0) + 1
            return {"ResponseStatus": {"Status": "AUTHENTICATION_ERROR"}, "SearchResults": None}

        with patch.object(activity, "WORKERS", 1), self.assertRaisesRegex(RuntimeError, "AUTHENTICATION_ERROR"):
            activity.collect(date(2026, 10, 26), request, lambda *_args, **_kwargs: None)
        self.assertTrue(all(attempts == 1 for attempts in requests.values()))


if __name__ == "__main__":
    unittest.main()
