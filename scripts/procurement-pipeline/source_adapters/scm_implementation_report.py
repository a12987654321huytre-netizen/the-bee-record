"""SCM implementation-report adapter with explicitly paired award/date labels."""
from __future__ import annotations
from pathlib import Path
import re
from typing import Any
from layouts import collapse, pdf_table_text


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    text = pdf_table_text(path)
    blocks = re.split(r"(?im)(?=^\s*(?:awarded\s+to|successful\s+bidder)\s*:)", text)
    rows = []
    for block in blocks:
        name_match = re.search(r"(?im)^\s*(?:awarded\s+to|successful\s+bidder)\s*:\s*(.+?)\s*$", block)
        level_match = re.search(r"(?im)^\s*(?:b\s*-?\s*bb?ee\s+)?(?:contribution\s+)?level\s*:\s*(.+?)\s*$", block)
        date_match = re.search(r"(?im)^\s*(?:award|adjudication|confirmation)\s+date\s*:\s*(.+?)\s*$", block)
        if not name_match:
            continue
        tender_match = re.search(r"(?im)^\s*tender\s+(?:number|no\.?)[ :]+(.+?)\s*$", block)
        rows.append({
            "supplier_name": collapse(name_match.group(1)),
            "bee_level_raw": collapse(level_match.group(1)) if level_match else "",
            "date_raw": collapse(date_match.group(1)) if date_match else "",
            "tender_number": collapse(tender_match.group(1)) if tender_match else None,
            "outcome": "awarded",
        })
    return rows
