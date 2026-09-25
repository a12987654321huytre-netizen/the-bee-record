"""Small, explicit parsing primitives shared by source-family adapters."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
from typing import Any


def collapse(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()


class _Tables(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self.table: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(collapse("".join(self.cell)))
            self.cell = None
        elif tag == "tr" and self.row is not None and self.table is not None:
            if any(self.row):
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            if self.table:
                self.tables.append(self.table)
            self.table = None

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)


def html_tables(html: str) -> list[list[list[str]]]:
    parser = _Tables()
    parser.feed(html)
    return parser.tables


def header_map(header: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for i, cell in enumerate(header):
        key = collapse(cell).lower()
        if re.search(r"awarded\s+to|successful\s+(bidder|supplier|tenderer)", key):
            result.setdefault("name", i)
            result.setdefault("outcome", i)
        elif re.search(r"name\s+of\s+(the\s+)?(bidder|tenderer)|bidder\s+name", key):
            result.setdefault("name", i)
            result.setdefault("bidder", i)
        elif re.search(r"supplier|service\s+provider|company\s+name", key):
            result.setdefault("name", i)
        if re.search(r"b\s*-?\s*bb?ee|bee\s+level|contribution\s+level|^level$", key):
            result.setdefault("level", i)
        if re.search(r"closing|award(ed)?\s+date|date\s+(?:of\s+)?award(ed)?", key):
            result.setdefault("date", i)
        if re.search(r"tender\s*(no|number)|reference\s*(no|number)|bid\s*(no|number)", key):
            result.setdefault("tender", i)
        if "description" in key:
            result.setdefault("description", i)
    return result


def parse_html_table(html: str, default_outcome: str | None = None) -> list[dict[str, Any]]:
    """Extract table rows while preserving the distinction between bidder and award headers."""
    found: list[dict[str, Any]] = []
    for table in html_tables(html):
        if len(table) < 2:
            continue
        mapping = header_map(table[0])
        data_start = 1
        if "name" not in mapping or "level" not in mapping:
            for i, row in enumerate(table[1:3], start=1):
                candidate = header_map(row)
                if "name" in candidate and "level" in candidate:
                    mapping, data_start = candidate, i + 1
                    break
        if "name" not in mapping or "level" not in mapping:
            continue
        outcome = "awarded" if "outcome" in mapping else ("bidder_register" if "bidder" in mapping else default_outcome)
        for cells in table[data_start:]:
            if max(mapping["name"], mapping["level"]) >= len(cells):
                continue
            row: dict[str, Any] = {
                "supplier_name": cells[mapping["name"]],
                "bee_level_raw": cells[mapping["level"]],
                "outcome": outcome,
            }
            for key, target in (("date", "date_raw"), ("tender", "tender_number"), ("description", "tender_description")):
                if key in mapping and mapping[key] < len(cells):
                    row[target] = cells[mapping[key]]
            found.append(row)
    return found


def pdf_table_text(path: Path) -> str:
    """Extract PDF text with pypdf; keep this dependency explicit and fail visibly."""
    if path.suffix.lower() in {".txt", ".text"}:
        return path.read_text(encoding="utf-8", errors="replace")
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF parsing requires pypdf; install scripts/procurement-pipeline/requirements.txt") from exc
    reader = PdfReader(str(path), strict=False)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def date_from_text(text: str) -> str | None:
    """Extract a source-stated date without using download time or a filename."""
    from datetime import date
    months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", text)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b", text)
    if m and m[2][:3].lower() in months:
        try:
            return date(int(m[3]), months[m[2][:3].lower()], int(m[1])).isoformat()
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,2})[-/]([A-Za-z]{3})[-/](20\d{2}|\d{2})\b", text)
    if m and m[2].lower() in months:
        try:
            year = int(m[3]) if len(m[3]) == 4 else 2000 + int(m[3])
            return date(year, months[m[2].lower()], int(m[1])).isoformat()
        except ValueError:
            return None
    m = re.search(r"\b([A-Za-z]+)\s+(20\d{2})\b", text)
    if m and m[1][:3].lower() in months:
        return f"{m[2]}-{months[m[1][:3].lower()]:02d}"
    m = re.search(r"\b(20\d{2})\b", text)
    return m[1] if m else None
