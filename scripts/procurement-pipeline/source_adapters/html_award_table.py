"""Generic HTML award-table adapter (TWK-style: AWARDED TO + B-BBEE LEVEL)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from layouts import parse_html_table


def parse(path: Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    html = path.read_text(errors="replace")
    rows = parse_html_table(html, default_outcome=meta.get("evidence_mode") or "awarded")
    return rows
