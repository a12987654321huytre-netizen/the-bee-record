"""Pre-import policy checks. Rejected rows are returned with explicit reasons."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from typing import Any

from layouts import collapse, date_from_text

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("legacy_procurement_parser", ROOT / "scripts" / "scrape-procurement.py")
_legacy = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_legacy)


def parse_explicit_level(raw: Any) -> str | None:
    """Accept only an explicit B-BBEE level 1–8; never mine points or prose."""
    value = collapse(str(raw or ""))
    m = re.fullmatch(r"(?:b\s*-?\s*bb?ee\s*(?:contributor\s*)?(?:level\s*)?|contribution\s+level\s*|level\s*|l\s*)([1-8])", value, re.I)
    if m:
        return m.group(1)
    if re.fullmatch(r"[1-8]", value):
        return value
    return None


def validate_candidate(row: dict[str, Any], meta: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    reasons: list[str] = []
    name = _legacy.salvage_name(_legacy.clean_name(collapse(row.get("supplier_name"))))
    source_url = collapse(row.get("source_url") or meta.get("source_url"))
    institution = collapse(row.get("institution") or meta.get("institution"))
    level = parse_explicit_level(row.get("bee_level_raw", row.get("bee_level")))
    evidence_date = date_from_text(str(row.get("award_date") or row.get("date_raw") or ""))
    outcome = collapse(row.get("outcome")).lower()

    if not level:
        reasons.append("invalid_level")
    if not evidence_date:
        reasons.append("missing_date")
    elif evidence_date[:4] < "2024":
        reasons.append("pre_2024")
    if not source_url or not source_url.startswith(("https://", "http://")) or not institution:
        reasons.append("missing_source")
    if outcome not in {"awarded", "bidder_register", "responded", "unsuccessful"}:
        reasons.append("ambiguous_semantics")
    if meta.get("evidence_mode") == "bidder_register":
        # Source-family registration is authoritative; a parser cannot turn an
        # opening register into an award notice.
        outcome = "bidder_register"
    if outcome == "awarded" and re.search(r"name\s+of\s+(the\s+)?bidder|bidder\s+register|bids\s+received", collapse(meta.get("document_title")), re.I):
        reasons.append("ambiguous_semantics")
    if not name or _legacy.malformed(name):
        reasons.append("parser_fragment" if name and len(name) < 24 else "malformed_name")
    elif _legacy.is_jv(name):
        reasons.append("joint_venture")

    if reasons:
        return None, list(dict.fromkeys(reasons))
    return {
        "canonicalName": name,
        "legalName": name,
        "procurement": {
            "sourceUrl": source_url,
            "governmentInstitution": institution,
            "tenderNumber": collapse(row.get("tender_number")) or None,
            "tenderDescription": collapse(row.get("tender_description"))[:240] or None,
            "awardDate": evidence_date,
            "beeLevel": level,
            "sourceTitle": collapse(row.get("source_title") or meta.get("document_title")) or None,
            "outcome": outcome,
        },
    }, []


def validate_rows(rows: list[dict[str, Any]], meta: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    valid: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for row in rows:
        item, reasons = validate_candidate(row, meta)
        if item:
            valid.append(item)
        else:
            rejected.append({"row": row, "reasons": reasons})
    return valid, rejected
