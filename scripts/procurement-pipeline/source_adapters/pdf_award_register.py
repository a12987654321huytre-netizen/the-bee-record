"""Award-register adapter for documents that explicitly identify awardees."""
from __future__ import annotations
from pathlib import Path
import re
from typing import Any
from layouts import collapse, pdf_table_text


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    text = pdf_table_text(path)
    if meta.get("source_family_id") == "ndoh_successful_suppliers":
        date_match = re.search(r"(?:successful\s+suppliers\s+(?:as\s+at|dated)|date\s+of\s+award|award\s+date)\s*[:\-]?\s*([^\n]+)", text, re.I)
        date_raw = date_match.group(1) if date_match else ""
        tender_match = re.search(r"HP\d{2}-\d{4}[A-Z]{2,4}(?:/\d+)?", text)
        rows = []
        pattern = re.compile(
            r"([A-Z][A-Za-z0-9&.'’\-() /]{3,90}?)\s+MAAA\d{5,10}\s+\S+\s+"
            r"(Non[- ]?compliant(?:\s+contributor)?|Non-B-BBEE Contributor|[0-9]{1,2})\b", re.I
        )
        for match in pattern.finditer(text):
            rows.append({"supplier_name": collapse(match.group(1)), "bee_level_raw": collapse(match.group(2)), "date_raw": date_raw, "tender_number": tender_match.group(0) if tender_match else None, "outcome": "awarded"})
        return rows
    date_match = re.search(r"(?:date\s+awarded|award\s+date|successful\s+suppliers\s+as\s+at)\s*[:\-]?\s*([^\n]+)", text, re.I)
    date_raw = date_match.group(1) if date_match else ""
    tender_match = re.search(r"(?:tender|bid)\s+number\s*[:\-]?\s*([^\n]+)", text, re.I)
    tender = collapse(tender_match.group(1)) if tender_match else None
    rows = []
    in_awards = False
    for line in text.splitlines():
        clean = collapse(line)
        if re.search(r"successful\s+(bidder|supplier|tenderer)|awarded\s+to", clean, re.I):
            in_awards = True
        if not in_awards or not clean:
            continue
        if re.search(r"cancelled|no\s+(acceptable\s+)?bids", clean, re.I):
            continue
        # Awarded-to prose can put a numeric level in the last column; the
        # semantics come from this adapter's award-only source family.
        inline_award = re.match(r"^awarded\s+to\s*:?\s*(.+?)\s+(Level\s*\d+|L\s*\d+|[0-9]{1,2})\s*$", clean, re.I)
        if inline_award:
            rows.append({"supplier_name": collapse(inline_award.group(1)), "bee_level_raw": collapse(inline_award.group(2)), "date_raw": date_raw, "tender_number": tender, "outcome": "awarded"})
            continue
        match = re.match(r"^(?:\d{1,3}\s+)?(.+?)\s+(Level\s*\d+|L\s*\d+|[0-9]{1,2}|Non[- ]?compliant|N/?A)\s*$", clean, re.I)
        if not match or re.search(r"successful\s+(bidder|supplier|tenderer)|awarded\s+to", match.group(1), re.I):
            continue
        rows.append({
            "supplier_name": collapse(match.group(1)),
            "bee_level_raw": collapse(match.group(2)),
            "date_raw": date_raw,
            "tender_number": tender,
            "outcome": "awarded",
        })
    # Also handle explicitly labeled awardee lines outside a table.
    for match in re.finditer(r"(?im)^\s*awarded\s+to\s*:\s*(.+?)\s*(?:\|\s*(?:B-?BBEE\s+)?level\s*:?\s*(\d{1,2}))?\s*$", text):
        name = collapse(match.group(1))
        level = match.group(2)
        if name and level:
            rows.append({"supplier_name": name, "bee_level_raw": level, "date_raw": date_raw, "tender_number": tender, "outcome": "awarded"})
    return rows
