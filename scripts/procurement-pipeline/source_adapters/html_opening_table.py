"""Generic HTML / text opening-register adapter (NAME OF BIDDER ≠ award)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from layouts import parse_html_table


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    text = path.read_text(errors="replace")
    rows = parse_html_table(text, default_outcome="bidder_register")
    for row in rows:
        if row.get("outcome") != "awarded":
            row["outcome"] = "bidder_register"
    return rows
