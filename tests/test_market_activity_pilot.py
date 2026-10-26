from datetime import date
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "market_activity_pilot",
    Path(__file__).resolve().parents[1] / "scripts" / "market_activity_pilot.py",
)
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)


class MarketActivityPilotTests(unittest.TestCase):
    def test_previous_complete_month(self):
        self.assertEqual(
            pilot.previous_month(date(2026, 10, 26)),
            (date(2026, 9, 1), date(2026, 9, 30)),
        )
        self.assertEqual(
            pilot.previous_month(date(2024, 3, 1)),
            (date(2024, 2, 1), date(2024, 2, 29)),
        )
        self.assertEqual(
            pilot.previous_month(date(2026, 1, 1)),
            (date(2025, 12, 1), date(2025, 12, 31)),
        )

    def test_unique_reports_not_building_rows(self):
        row = {"EntityIdentifier": 123}
        self.assertEqual(pilot.unique_changes([row, row]), [row])
        with self.assertRaises(ValueError):
            pilot.unique_changes([{}])

    def test_matching_is_exact_and_conflicts_fail(self):
        row = {"EnergyLabelSerialIdentifier": "123", "SubmitterCompanyIdentifier": "firm"}
        self.assertEqual(pilot.matching_report([row, row], "123"), row)
        self.assertIsNone(pilot.matching_report([row], "124"))
        with self.assertRaises(ValueError):
            pilot.matching_report([row, {**row, "SubmitterCompanyIdentifier": "other"}], "123")

    def test_sample_covers_change_types_instead_of_only_first_group(self):
        rows = [{"EntityIdentifier": index, "ChangeType": kind}
                for kind in (2, 1) for index in range(10)]
        self.assertEqual(
            [row["ChangeType"] for row in pilot.sample_changes(rows, 4)],
            [2, 1, 2, 1],
        )

    def test_sample_is_bounded_and_never_reports_monthly_totals(self):
        calls = []

        def request(endpoint):
            calls.append(endpoint)
            if endpoint.startswith("GetEnergyLabelChangeLog"):
                return {"SearchResults": [
                    {"EntityIdentifier": number, "MunicipalityNumber": "101",
                     "PropertyNumber": "1", "BuildingNumber": "1", "ChangeType": 0}
                    for number in range(100, 120)
                ]}
            if endpoint.startswith("SearchEnergyLabelBBR"):
                return {"SearchResults": [
                    {"EnergyLabelSerialIdentifier": str(number),
                     "SubmitterCompanyName": "Test", "SubmitterCompanyIdentifier": "firm"}
                    for number in range(100, 120)
                ]}
            serial = endpoint.split("/")[-1]
            return {"FindEnergyLabelInputResult": {"EnergyLabels": [
                {"EnergyLabelNumber": int(serial), "DateOfSubmission": "2026-09-01"}
            ]}}

        report = pilot.run_pilot(date(2026, 10, 26), request)
        self.assertEqual(len(calls), 12)
        self.assertEqual(report["coverage"]["sampledReports"], 8)
        self.assertEqual(report["coverage"]["withCompanyIdentifier"], 8)
        self.assertEqual(report["coverage"]["withSubmissionDate"], 2)
        self.assertIsNone(report["monthlyTotals"])

    def test_unexpected_api_schema_is_not_an_empty_success(self):
        with self.assertRaises(RuntimeError):
            pilot.run_pilot(date(2026, 10, 26), lambda _: {})


if __name__ == "__main__":
    unittest.main()
