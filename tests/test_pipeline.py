from __future__ import annotations

import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "scripts" / "procurement-pipeline"
sys.path.insert(0, str(PIPELINE))

import download as download_module  # noqa: E402
from ledger import content_hash_bytes, ensure_document, load_sources  # noqa: E402
from parse import dispatch, normalize_corpus  # noqa: E402
from validate import parse_explicit_level, validate_candidate  # noqa: E402
from layouts import parse_html_table  # noqa: E402

FIXTURES = ROOT / "data" / "procurement-pipeline" / "fixtures"
META = {
    "source_family_id": "cticc_opening",
    "institution": "Cape Town International Convention Centre",
    "source_url": "https://example.gov.za/register.pdf",
    "document_title": "Bid opening register",
    "evidence_mode": "bidder_register",
    "adapter": "pdf_opening_register",
}


def candidate(**overrides):
    row = {
        "supplier_name": "Harbour Catering (Pty) Ltd",
        "bee_level_raw": "Level 1",
        "date_raw": "22 June 2025",
        "outcome": "awarded",
    }
    row.update(overrides)
    return row


class PipelineTests(unittest.TestCase):
    def test_only_explicit_levels_one_to_eight_are_accepted(self):
        self.assertEqual([parse_explicit_level(f"Level {n}") for n in range(1, 9)], list("12345678"))
        for value in ("0", "10", "18", "29", "210", "non-compliant", "N/A", "", "unknown", "85 points"):
            with self.subTest(value=value):
                self.assertIsNone(parse_explicit_level(value))

    def test_missing_date_and_pre_2024_rows_are_rejected(self):
        item, reasons = validate_candidate(candidate(date_raw=""), META)
        self.assertIsNone(item)
        self.assertIn("missing_date", reasons)
        item, reasons = validate_candidate(candidate(date_raw="2023"), META)
        self.assertIsNone(item)
        self.assertIn("pre_2024", reasons)
        modern, reasons = validate_candidate(candidate(date_raw="2024"), META)
        self.assertEqual(reasons, [])
        self.assertEqual(modern["procurement"]["awardDate"], "2024")

    def test_source_date_precision_is_preserved(self):
        for raw, expected in (("2024", "2024"), ("March 2025", "2025-03"), ("22 June 2025", "2025-06-22")):
            with self.subTest(raw=raw):
                item, reasons = validate_candidate(candidate(date_raw=raw), META)
                self.assertEqual(reasons, [])
                self.assertEqual(item["procurement"]["awardDate"], expected)

    def test_jv_and_malformed_supplier_rows_are_rejected(self):
        item, reasons = validate_candidate(candidate(supplier_name="Harbour Catering JV Coastal Roads"), META)
        self.assertIsNone(item)
        self.assertIn("joint_venture", reasons)
        item, reasons = validate_candidate(candidate(supplier_name="Ltd"), META)
        self.assertIsNone(item)
        self.assertTrue({"malformed_name", "parser_fragment"}.intersection(reasons))

    def test_opening_register_never_becomes_an_award(self):
        rows = dispatch(FIXTURES / "cticc-opening.txt", META, {"source_url": META["source_url"]})
        self.assertGreaterEqual(len(rows), 2)
        self.assertTrue(all(row["outcome"] == "bidder_register" for row in rows))
        valid, rejected = [], []
        for row in rows:
            item, reasons = validate_candidate(row, META)
            (valid if item else rejected).append(item if item else reasons)
        self.assertTrue(all(i["procurement"]["outcome"] == "bidder_register" for i in valid))
        self.assertTrue(any("invalid_level" in reasons for reasons in rejected))

    def test_award_and_scm_adapters_keep_explicit_award_semantics(self):
        award_meta = {**META, "source_family_id": "overstrand_award", "evidence_mode": "awarded", "institution": "Overstrand Municipality"}
        award_rows = dispatch(FIXTURES / "overstrand-award.txt", {**award_meta, "adapter": "pdf_award_register"}, {"source_url": award_meta["source_url"]})
        self.assertTrue(award_rows)
        self.assertTrue(all(row["outcome"] == "awarded" for row in award_rows))
        scm_meta = {**META, "source_family_id": "swartland_scm", "evidence_mode": "awarded", "institution": "Swartland Municipality", "adapter": "scm_implementation_report"}
        scm_rows = dispatch(FIXTURES / "swartland-scm.txt", scm_meta, {"source_url": scm_meta["source_url"]})
        self.assertEqual([row["outcome"] for row in scm_rows], ["awarded", "awarded"])
        self.assertEqual(scm_rows[1]["date_raw"], "March 2025")

    def test_html_header_aliases_preserve_bidder_semantics(self):
        html = "<table><tr><th>NAME OF BIDDER</th><th>B-BBEE LEVEL</th><th>Closing Date</th></tr><tr><td>Harbour Catering (Pty) Ltd</td><td>Level 1</td><td>22 June 2025</td></tr></table>"
        rows = parse_html_table(html, default_outcome="awarded")
        self.assertEqual(rows[0]["outcome"], "bidder_register")
        self.assertEqual(rows[0]["date_raw"], "22 June 2025")

    def test_sars_adapter_uses_award_date_column_not_contract_period(self):
        html = ROOT / "work-sars-pipeline-test.html"
        family = {"source_family_id": "sars_awarded", "institution": "South African Revenue Service", "adapter": "html_award_table", "evidence_mode": "awarded"}
        try:
            html.write_text("<table><tr><th>Reference Number</th><th>Description</th><th>Supplier</th><th>BBBEE Level</th><th>Preference Points</th><th>Contract Price</th><th>Contract Period</th><th>Date of award</th></tr><tr><td>RFP 1/2025</td><td>Service</td><td>Harbour Catering (Pty) Ltd</td><td>Level 1</td><td>8</td><td>1</td><td>5 Years</td><td>06-Aug-26</td></tr></table>")
            rows = dispatch(html, family, {"source_url": "https://www.sars.gov.za/procurement/awarded-tenders/"})
            item, reasons = validate_candidate(rows[0], {**family, "source_url": "https://www.sars.gov.za/procurement/awarded-tenders/"})
            self.assertEqual(reasons, [])
            self.assertEqual(item["procurement"]["awardDate"], "2026-08-06")
        finally:
            html.unlink(missing_ok=True)

    def test_corpus_grouping_deduplicates_evidence_and_only_emits_procurement(self):
        good, reasons = validate_candidate(candidate(), META)
        self.assertEqual(reasons, [])
        corpus = normalize_corpus([good, good])
        self.assertEqual(len(corpus), 1)
        self.assertEqual(len(corpus[0]["procurement"]), 1)
        self.assertNotIn("certificates", corpus[0])
        self.assertNotIn("evidence", corpus[0])

    def test_registry_and_adapter_dispatch_are_available(self):
        sources = load_sources()
        self.assertGreater(len(sources["source_families"]), 0)
        for family in sources["source_families"]:
            self.assertTrue(family.get("adapter"), family["source_family_id"])
            __import__(f"source_adapters.{family['adapter']}")
        twk = next(f for f in sources["source_families"] if f["source_family_id"] == "twk_awarded")
        html = ROOT / "work-pipeline-test.html"
        try:
            html.write_text("<table><tr><th>AWARDED TO</th><th>B-BBEE level</th><th>Date awarded</th></tr><tr><td>Harbour Catering (Pty) Ltd</td><td>Level 1</td><td>22 June 2025</td></tr></table>")
            rows = dispatch(html, twk, {"source_url": twk["seed_urls"][0]})
            self.assertEqual(rows[0]["outcome"], "awarded")
        finally:
            html.unlink(missing_ok=True)

    def test_imported_unchanged_documents_are_skipped_but_changed_hashes_are_reparsed(self):
        family = {"source_family_id": "test", "institution": "Example Municipality", "evidence_mode": "awarded", "active": True, "seed_urls": ["https://example.gov.za/award.pdf"]}
        unchanged_hash = content_hash_bytes(b"unchanged")
        progress = {"documents": {}, "runs": [], "import_checkpoint": {}}
        doc = ensure_document(progress, family, family["seed_urls"][0])
        doc.update(status="IMPORTED", import_status="IMPORTED", content_hash=unchanged_hash, imported_content_hash=unchanged_hash)
        with patch.object(download_module, "load_sources", return_value={"source_families": [family]}), patch.object(download_module, "load_progress", return_value=progress), patch.object(download_module, "save_progress"), patch.object(download_module, "fetch", return_value=(True, "ok", unchanged_hash)), patch.object(download_module, "local_path_for", return_value=Path("/tmp/unused")):
            result = download_module.download_pending()
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(doc["status"], "IMPORTED")

        changed_hash = content_hash_bytes(b"changed source bytes")
        with patch.object(download_module, "load_sources", return_value={"source_families": [family]}), patch.object(download_module, "load_progress", return_value=progress), patch.object(download_module, "save_progress"), patch.object(download_module, "fetch", return_value=(True, "ok", changed_hash)), patch.object(download_module, "local_path_for", return_value=Path("/tmp/unused")):
            result = download_module.download_pending()
        self.assertEqual(result["ok"], 1)
        self.assertEqual(doc["parser_status"], "changed")
        self.assertNotEqual(doc["download_hash"], doc["content_hash"])

    def test_pre_2024_candidate_cannot_enter_normalized_public_corpus(self):
        item, reasons = validate_candidate(candidate(date_raw="2023"), META)
        self.assertIsNone(item)
        self.assertIn("pre_2024", reasons)
        self.assertEqual(normalize_corpus([]), [])


if __name__ == "__main__":
    unittest.main()
