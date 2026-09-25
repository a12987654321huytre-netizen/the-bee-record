"""Generic HTML / text opening-register adapter (NAME OF BIDDER ≠ award)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from layouts import parse_html_table


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    rows = parse_html_table(text, default_outcome="bidder_register")
    for row in rows:
        row["outcome"] = "bidder_register"
        row["source_title"] = meta.get("document_title") or meta.get("institution")
        row["source_url"] = meta.get("source_url")
        row["institution"] = meta.get("institution")
    return rows
