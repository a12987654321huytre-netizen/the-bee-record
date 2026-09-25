"""Generic HTML award-table adapter (TWK-style: AWARDED TO + B-BBEE LEVEL)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from layouts import collapse, date_from_text, header_map, html_tables, parse_html_table


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    html = path.read_text(encoding="utf-8", errors="replace")
    rows = parse_html_table(html, default_outcome=meta.get("evidence_mode") or "awarded")
    # SARS puts the year as a two-digit year and has an extra data cell hidden
    # under its preference-points colspan. Pair rows by exact supplier+tender
    # headings, then take only a value that is actually date-shaped.
    if meta.get("source_family_id") == "sars_awarded":
        source_dates = {}
        for table in html_tables(html):
            if not table:
                continue
            mapping = header_map(table[0])
            if "date" not in mapping or "name" not in mapping:
                continue
            for cells in table[1:]:
                if mapping["name"] >= len(cells):
                    continue
                supplier = collapse(cells[mapping["name"]])
                tender = collapse(cells[mapping["tender"]]) if "tender" in mapping and mapping["tender"] < len(cells) else ""
                for value in cells[mapping["date"]:]:
                    if date_from_text(value):
                        source_dates[(supplier, tender)] = value
                        break
        for row in rows:
            row["date_raw"] = source_dates.get((collapse(row.get("supplier_name")), collapse(row.get("tender_number"))), row.get("date_raw", ""))
    for row in rows:
        row["source_title"] = meta.get("document_title") or meta.get("institution")
        row["source_url"] = meta.get("source_url")
        row["institution"] = meta.get("institution")
        if row.get("outcome") is None:
            row["outcome"] = "awarded"
    return rows
