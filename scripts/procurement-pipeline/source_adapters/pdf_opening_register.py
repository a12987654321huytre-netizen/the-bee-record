"""Opening-register adapter: bidder names remain bidder_register evidence."""
from __future__ import annotations
from pathlib import Path
import re
from typing import Any
from layouts import collapse, date_from_text, pdf_table_text


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    text = pdf_table_text(path)
    level_column = False
    date_match = re.search(r"(?:closing|opening)\s+date\s*[:\-]?\s*([^\n]+)", text, re.I)
    date_raw = date_match.group(1) if date_match else ""
    tender_match = re.search(r"tender\s+number\s*[:\-]?\s*([^\n]+)", text, re.I)
    tender = collapse(tender_match.group(1)) if tender_match else None
    rows = []
    in_register = False
    for line in text.splitlines():
        clean = collapse(line)
        if re.search(r"name\s+of\s+(the\s+)?(bidder|tenderer)|bidder\s+name", clean, re.I):
            in_register = True
            level_column = bool(re.search(r"b\s*-?\s*bb?ee|bee\s+level|contribution\s+level", clean, re.I))
            continue
        if not in_register or not clean:
            continue
        if re.search(r"officials\s+responsible|end\s+of\s+register", clean, re.I):
            in_register = False
            continue
        # This layout requires a level cell at the end of the bidder row. It
        # never looks for preference points or infers a level from a score.
        level_cell = r"Level\s*\d+|L\s*\d+|Non[- ]?compliant|Not attached|N/?A|\?"
        if level_column:
            level_cell += r"|\d{1,2}"
        match = re.match(rf"^(\d{{1,3}}\s+)?(.+?)\s+({level_cell})\s*$", clean, re.I)
        if not match:
            continue
        rows.append({
            "supplier_name": collapse(match.group(2)),
            "bee_level_raw": collapse(match.group(3)),
            "date_raw": date_raw,
            "tender_number": tender,
            "outcome": "bidder_register",
        })
    return rows
