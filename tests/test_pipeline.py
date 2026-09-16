from __future__ import annotations

import gzip
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from io import BytesIO
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import pipeline
from pipeline import (
    Building,
    _aggregate_dashboard_scopes,
    _bucket,
    _consultant_name_from_search,
    _eligibility_exclusion_reason,
    _heated_bbr_area,
    _municipality_coowner_cvrs,
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

    def test_heated_bbr_area_combines_residential_and_commercial_area(self) -> None:
        self.assertEqual(
            _heated_bbr_area({"Boligareal": "125", "Erhvervsareal": "275"}),
            400,
        )
        self.assertEqual(
            _heated_bbr_area({"Boligareal": "", "Erhvervsareal": "60"}),
            60,
        )

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
        self.assertEqual(
            building.compact()[8:],
            ["EM123", "2030-01-02", "direct", ""],
        )

    def test_municipality_coowners_match_mojibake_and_multiple_owners(self) -> None:
        municipalities = {
            "1": "Morsø Kommune",
            "2": "Lemvig Kommune",
            "3": "Holstebro Kommune",
        }
        self.assertEqual(
            _municipality_coowner_cvrs(
                "Region Nordjylland (001), Mors\ufffd Kommune (000)",
                municipalities,
            ),
            ("1",),
        )
        self.assertEqual(
            _municipality_coowner_cvrs(
                "Lemvig Kommune (001), Holstebro Kommune (000)",
                municipalities,
            ),
            ("2", "3"),
        )

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
        self.assertEqual(
            _eligibility_exclusion_reason(
                "110",
                59,
                False,
                "Fjernvarme",
                minimum_area=60,
            ),
            "outsidePublicAreaThresholdBuildings",
        )
        self.assertIsNone(
            _eligibility_exclusion_reason(
                "110",
                60,
                False,
                "Fjernvarme",
                minimum_area=60,
            )
        )

    def test_area_and_ownership_scopes_are_independent(self) -> None:
        small = Building("1", "101", ("10",), "1", 60)
        large = Building("1", "101", ("20",), "2", 251)
        coowned_large = Building(
            "1",
            "101",
            ("30",),
            "3",
            300,
            ownership_type="co-owner",
            primary_owner="Region Test",
        )
        coowned_small = Building(
            "1",
            "101",
            ("40",),
            "4",
            100,
            ownership_type="co-owner",
            primary_owner="Region Test",
        )
        buildings = {
            ("1", "10", "1"): small,
            ("1", "20", "2"): large,
            ("1", "30", "3"): coowned_large,
            ("1", "40", "4"): coowned_small,
        }
        labels = {
            "EM1": {
                "validTo": date(2027, 1, 1),
                "owners": {"1": {("1", "10", "1"): small}},
            },
            "EM2": {
                "validTo": date(2027, 1, 2),
                "owners": {"1": {("1", "20", "2"): large}},
            },
            "EM3": {
                "validTo": date(2027, 1, 3),
                "owners": {"1": {("1", "30", "3"): coowned_large}},
            },
            "EM4": {
                "validTo": date(2027, 1, 4),
                "owners": {"1": {("1", "40", "4"): coowned_small}},
            },
        }

        dashboard, scopes = _aggregate_dashboard_scopes(
            municipalities={"1": "Test Kommune"},
            municipality_codes={"1": "101"},
            labels=labels,
            buildings=buildings,
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={},
        )

        self.assertEqual(set(scopes["current"][0]), {("1", "20", "2")})
        self.assertEqual(set(scopes["current"][1]), {"EM2"})
        self.assertEqual(dashboard["totals"]["buildings"]["2027"], 1)
        self.assertEqual(
            dashboard["expandedAreaScope"]["totals"]["buildings"]["2027"],
            2,
        )
        self.assertEqual(
            dashboard["coOwnedScope"]["totals"]["buildings"]["2027"],
            2,
        )
        self.assertEqual(
            dashboard["expandedAreaAndCoOwnedScope"]["totals"]["buildings"]["2027"],
            4,
        )
        self.assertEqual(dashboard["quality"]["inventoryBuildings"], 1)
        self.assertEqual(
            dashboard["expandedAreaScope"]["quality"]["inventoryBuildings"],
            2,
        )
        self.assertEqual(dashboard["quality"]["addedAreaScopeBuildings"], 1)
        self.assertEqual(dashboard["quality"]["availableCoOwnedBuildings"], 1)

    def test_company_lookup_parses_em_number_and_company(self) -> None:
        content = """
        <table><tbody><tr>
          <td>1</td><td>Testvej</td><td>1</td><td>1234</td><td>Testby</td>
          <td>101</td><td>10</td><td>1</td><td>320</td><td>2020</td>
          <td>A</td><td>A</td><td>A</td><td>311383519</td>
          <td>01/01/2020</td><td>01/01/2030</td>
          <td>Test &amp; Energi ApS</td>
        </tr></tbody></table>
        """
        self.assertEqual(
            pipeline._parse_company_lookup_html(content),
            {"311383519": "Test & Energi ApS"},
        )

    def test_company_lookup_writes_addresses_to_template_rows(self) -> None:
        cells = "".join(
            f'<c r="{column}2" t="inlineStr"><is><t></t></is></c>'
            for column in "ABCDEFGHI"
        )
        worksheet = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/'
            'spreadsheetml/2006/main"><sheetData>'
            f'<row r="2">{cells}</row></sheetData></worksheet>'
        )
        template = BytesIO()
        with zipfile.ZipFile(template, "w") as workbook:
            workbook.writestr("xl/worksheets/sheet1.xml", worksheet)

        content = pipeline._company_lookup_workbook(
            template.getvalue(),
            [("Testvej", "12A", "1234")],
        )

        with zipfile.ZipFile(BytesIO(content)) as workbook:
            generated = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
        self.assertIn(">Testvej</t>", generated)
        self.assertIn(">12A</t>", generated)
        self.assertIn(">1234</t>", generated)

    def test_consultant_name_is_read_from_matching_energy_label(self) -> None:
        self.assertEqual(
            _consultant_name_from_search(
                {
                    "SearchResults": [
                        {
                            "EnergyLabelSerialIdentifier": "311383519",
                            "SubmitterConsultantName": "Morten Kiil Poulsen",
                        }
                    ]
                },
                "311383519",
            ),
            "Morten Kiil Poulsen",
        )
        self.assertEqual(
            _consultant_name_from_search(
                {
                    "SearchResults": None,
                    "ResponseStatus": {"Status": "RESULT_EMPTY"},
                },
                "311000000",
            ),
            "",
        )

    def test_consultant_lookup_uses_serial_search(self) -> None:
        with mock.patch.object(
            pipeline,
            "_request_json",
            return_value={
                "SearchResults": [
                    {
                        "EnergyLabelSerialIdentifier": "311383519",
                        "SubmitterConsultantName": "Morten Kiil Poulsen",
                    }
                ]
            },
        ) as request_json:
            result = pipeline._fetch_energy_label_consultants(
                ["311383519"],
                "user",
                "password",
            )
        self.assertEqual(result, {"311383519": "Morten Kiil Poulsen"})
        request_json.assert_called_once_with(
            pipeline.EMODATA_CONSULTANT_URL.format(serial="311383519"),
            "user",
            "password",
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

    def test_company_analysis_summarizes_reports_area_and_municipalities(self) -> None:
        first = Building("1", "101", ("10",), "1", 100)
        second = Building("1", "101", ("10",), "2", 200)
        third = Building("2", "102", ("20",), "1", 300)
        unattributed = Building("2", "102", ("30",), "1", 400)
        result = aggregate_labels(
            municipalities={"1": "Første Kommune", "2": "Anden Kommune"},
            municipality_codes={"1": "101", "2": "102"},
            labels={
                "EM1": {
                    "validTo": date(2027, 1, 1),
                    "companyName": "Test Energi ApS",
                    "consultantName": "Anne Rådgiver",
                    "owners": {
                        "1": {
                            ("1", "10", "1"): first,
                            ("1", "10", "2"): second,
                        }
                    },
                },
                "EM2": {
                    "validTo": date(2026, 1, 1),
                    "companyName": "Test Energi ApS",
                    "consultantName": "Anne Rådgiver",
                    "owners": {"2": {("2", "20", "1"): third}},
                },
                "EM3": {
                    "validTo": date(2038, 1, 1),
                    "companyName": "",
                    "owners": {"2": {("2", "30", "1"): unattributed}},
                },
            },
            buildings={
                ("1", "10", "1"): first,
                ("1", "10", "2"): second,
                ("2", "20", "1"): third,
                ("2", "30", "1"): unattributed,
            },
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={},
        )

        analysis = result["companyAnalysis"]
        self.assertEqual(analysis["totalReports"], 3)
        self.assertEqual(analysis["attributedReports"], 2)
        self.assertEqual(analysis["attributedBuildings"], 3)
        self.assertEqual(analysis["attributedArea"], 600)
        company = analysis["companies"][0]
        self.assertEqual(company["reports"], 2)
        self.assertEqual(company["buildings"], 3)
        self.assertEqual(company["area"], 600)
        self.assertEqual(company["expiry"]["expired"], 1)
        self.assertEqual(company["expiry"]["2027"], 1)
        self.assertEqual(len(company["municipalities"]), 2)
        self.assertEqual(company["municipalities"][0]["name"], "Første Kommune")
        consultant_analysis = result["consultantAnalysis"]
        self.assertEqual(consultant_analysis["attributedReports"], 2)
        consultant = consultant_analysis["consultants"][0]
        self.assertEqual(consultant["name"], "Anne Rådgiver")
        self.assertEqual(consultant["companyName"], "Test Energi ApS")
        self.assertEqual(consultant["buildings"], 3)
        self.assertEqual(consultant["area"], 600)
        self.assertEqual(len(consultant["municipalities"]), 2)

    def test_consultants_with_same_name_at_different_companies_stay_separate(self) -> None:
        first = Building("1", "101", ("10",), "1", 100)
        second = Building("1", "101", ("20",), "2", 200)
        result = aggregate_labels(
            municipalities={"1": "Test Kommune"},
            municipality_codes={"1": "101"},
            labels={
                "EM1": {
                    "validTo": date(2027, 1, 1),
                    "companyName": "Firma A",
                    "consultantName": "Samme Navn",
                    "owners": {"1": {("1", "10", "1"): first}},
                },
                "EM2": {
                    "validTo": date(2027, 1, 1),
                    "companyName": "Firma B",
                    "consultantName": "Samme Navn",
                    "owners": {"1": {("1", "20", "2"): second}},
                },
            },
            buildings={
                ("1", "10", "1"): first,
                ("1", "20", "2"): second,
            },
            as_of=date(2026, 9, 4),
            source_name="fixture",
            quality={},
        )
        consultants = result["consultantAnalysis"]["consultants"]
        self.assertEqual(len(consultants), 2)
        self.assertEqual(
            {consultant["companyName"] for consultant in consultants},
            {"Firma A", "Firma B"},
        )

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
            300,
            source_energy_label="EM-SOURCE",
            source_valid_to=date(2030, 1, 1),
        )
        unlabelled = Building("1", "101", ("20",), "2", 400)
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
                mock.patch.object(
                    pipeline,
                    "_fetch_energy_label_companies",
                    return_value={"EM-SOURCE": "Kilde Firma"},
                ),
                mock.patch.object(
                    pipeline,
                    "_fetch_energy_label_consultants",
                    return_value={},
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
        self.assertEqual(result["schemaVersion"], 6)
        self.assertEqual(result["companyAnalysis"]["attributedReports"], 1)
        self.assertEqual(
            result["companyAnalysis"]["companies"][0]["name"],
            "Kilde Firma",
        )

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
                                "DEMOLink": "",
                            }
                        ]
                    },
                ),
                mock.patch.object(
                    pipeline,
                    "_fetch_energy_label_companies",
                    return_value={"311199190": "Test Energi ApS"},
                ),
                mock.patch.object(
                    pipeline,
                    "_fetch_energy_label_consultants",
                    return_value={"311199190": "Test Konsulent"},
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
            "https://tjekenergimaerke.emoweb.dk/api/attachment/pdf/311199190",
        )
        self.assertEqual(
            payload["buildings"][0]["companyName"],
            "Test Energi ApS",
        )
        self.assertEqual(
            payload["buildings"][0]["consultantName"],
            "Test Konsulent",
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
            self.assertIn("Energimærkningsfirma", worksheet)
            self.assertIn("Energikonsulent", worksheet)
            self.assertIn("Opvarmet BBR-areal (m²)", worksheet)
            self.assertIn("Ejerskab", worksheet)
            self.assertIn("Primær registreret ejer", worksheet)
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
                "companyName": "Test Energi ApS",
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
        self.assertEqual(
            payload["buildings"][1]["companyName"],
            "Test Energi ApS",
        )


if __name__ == "__main__":
    unittest.main()
