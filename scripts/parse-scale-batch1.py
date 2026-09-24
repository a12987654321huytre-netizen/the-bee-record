#!/usr/bin/env python3
"""Parse Drakenstein tender-opening PDFs and Swartland council tables into corpus JSON.

Bidder-register rows stay bidder_register. A Swartland row is awarded only when the
same document names that supplier as the awarded tenderer. Levels come only from an
explicit L1–L8 or Contribution Level. NOT ATTACHED and level 0 are dropped.
"""
from __future__ import annotations

import importlib.util
import json
import random
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sp", ROOT / "scripts" / "scrape-procurement.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

SRC = Path("/tmp/bee-sources/batch1")
OUT = ROOT / "data" / "procurement"
OUT.mkdir(parents=True, exist_ok=True)

DRAKENSTEIN = {
    "PROC07-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC07.2026BID%20OPENING%20RESULTS.pdf",
    "PROC01-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%201.2026%20TENDER%20OPENING.pdf",
    "PROC02-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%202.2026%20TENDER%20OPENING.pdf",
    "PROC03-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%203.2026%20TENDER%20OPENING.pdf",
    "PROC04-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%204.2026%20TENDER%20OPENING.pdf",
    "CES24-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/CES%2024.2025%20TENDER%20OPENING.pdf",
    "PDHS01-2026.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PDHS%2001.2026%20BID%20OPENING%20RESULTS.pdf",
    "PROC05-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%205.2025%20-%20TENDER%20OPENING%20RESULTS.pdf",
    "PROC06-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%206.%202025%20-%20TENDER%20OPENING%20RESULTS.pdf",
    "SCM01-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/SCM%201.%202025%20-%20TENDER%20OPENING%20RESULTS.pdf",
    "SOCDEV07-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/SOCDEV%207.%202025%20%20%20BEE%20AND%20PRICE.pdf",
    "COMH-HOUSE01-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/COMH-HOUSE-%201.%202025%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC01-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%201.%202025%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC02-2025.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%202.%202025%20%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC08-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%208.%202024%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC10-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%2010.%202024%20%20%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC04-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%204.%202024%20%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC05-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%205.%202024%20%20%20BEE%20AND%20PRICE.pdf",
    "PROC03-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PROC%203.%202024%20%20BEE%20AND%20PRICE.pdf",
    "TSPM02-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/TSPM%202.%202024%20%20BEE%20AND%20PRICE.pdf",
    "INC01-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/INC%201.2024%20%20%20BEE%20AND%20PRICE_.pdf",
    "COMH-HOUSE01-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/COMH-HOUSE%201.%202024%20%20%20%20%20BEE%20AND%20PRICE.pdf",
    "PS01-2024.pdf": "https://www.drakenstein.gov.za/sites/dw/DocumentLibrary/PS%2001.2024%20%20%20BEE%20AND%20PRICE.pdf",
}

SWARTLAND = {
    "agenda-2026-03-31.pdf": "https://www.swartland.org.za/storage/assets/_Agenda%20Raad,%2031%20Maart%202026.pdf",
    "agenda-2025-07-31.pdf": "https://www.swartland.org.za/storage/assets/_Agenda%20Raad%2C%2031%20Julie%202025.pdf",
    "agenda-2024-05-31.pdf": "https://www.swartland.org.za/storage/assets/_2%20Agenda%20Raad%2C%2031%20Mei%202024_compressed.pdf",
}

MONTHS = r"January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"


def pdf_text(path: Path) -> str:
    reader = PdfReader(str(path), strict=False)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def modern(raw: str | None) -> str | None:
    parsed = sp.parse_date(raw)
    if parsed and re.fullmatch(r"20\d{2}-\d{2}-\d{2}", parsed) and parsed >= "2024-01-01":
        return parsed
    return None


HEADER_JUNK = re.compile(
    r"(?:total\s+points|bbbee\s+points|western\s+cape|yes\s*/\s*no\s*points|"
    r"contri-?\s*bution\s+level|points\s+for\s+price|no\s+indication|"
    r"procurement\s+points?|cape\s*swartland|pointtotal)",
    re.I,
)


def clean_bidder(raw: str) -> str:
    name = sp.collapse(raw)
    name = re.sub(r"(?:(?:Yes|No)\d[\d.]*\s*)+", " ", name, flags=re.I)
    parts = HEADER_JUNK.split(name)
    name = parts[-1] if parts else name
    name = re.sub(r"^Swartland\s+Mun\.?\s*", "", name, flags=re.I)
    name = re.sub(r"^[\d.\s]+", "", name)
    name = re.sub(r"\s+", " ", name).strip(" .,-/")
    name = re.sub(r"\bPTY\s+LTD\b", "(Pty) Ltd", name, flags=re.I)
    name = re.sub(r"\bPTYLTD\b", "(Pty) Ltd", name, flags=re.I)
    name = re.sub(r"\bPROP\.?\s*HOLDINGS\b", "Prop Holdings", name, flags=re.I)
    return sp.clean_name(name)


def accept_name(name: str) -> str | None:
    if not name or sp.is_jv(name) or sp.malformed(name):
        return None
    if re.search(
        r"\b(officials responsible|tender number|tender description|not attached|no indication|"
        r"total points|bbbee|competitive bidding|quotation)\b",
        name,
        re.I,
    ):
        return None
    if re.search(r"\bL\s*[1-8]\b|\bLEVEL\s*[1-8]\b", name, re.I):
        return None
    if re.search(r"\b(of an|of the|for a period|until 30)\b", name, re.I):
        return None
    if re.search(r"\d\.\d{2}|\b(?:Yes|No)\d|\bRATES\b", name, re.I):
        return None
    return name


def parse_drakenstein(path: Path, url: str) -> list[dict]:
    text = pdf_text(path)
    tender = None
    tm = re.search(r"TENDER\s+NUMBER\s+([A-Z][A-Z0-9 \-]{0,12}\d+\s*[./]\s*\d{4})", text, re.I)
    if tm:
        tender = sp.collapse(tm.group(1)).replace(" .", ".").replace(" ", "")
        tender = re.sub(r"([A-Z]+)(\d)", r"\1 \2", tender)
        tender = tender.replace(".", "/")
        tender = re.sub(r"\s+", " ", tender)
    desc = None
    dm = re.search(
        r"TENDER\s+DESCRIPTION\s+(.+?)\s+CLOSING\s+DATE",
        re.sub(r"\s+", " ", text),
        re.I,
    )
    if dm:
        desc = sp.collapse(dm.group(1))[:240]
    date_raw = None
    cm = re.search(
        rf"CLOSING\s+DATE\s+AND\s+TIME\s+(\d{{1,2}}\s+(?:{MONTHS})\s+20\d{{2}})",
        text,
        re.I,
    )
    if cm:
        date_raw = cm.group(1)
    award = modern(date_raw)
    if not award or not tender:
        return []
    body = text
    start = re.search(r"NAME\s+OF\s+TENDERER", text, re.I)
    if start:
        body = text[start.end() :]
    end = re.search(r"OFFICIALS\s+RESPONSIBLE", body, re.I)
    if end:
        body = body[: end.start()]
    flat = re.sub(r"\s+", " ", body)
    rows = []
    # Row number, supplier, explicit L1–L8. Prices and YES/NO stay outside the name.
    for m in re.finditer(
        r"(?:^|\s)(\d{1,3})\s+([A-Z][A-Z0-9&.'’\-\(\)/,+ ]{2,90}?)\s+L(?:EVEL)?\s*([1-8])\b",
        flat,
        re.I,
    ):
        name = accept_name(clean_bidder(m.group(2)))
        if not name:
            continue
        rows.append(
            sp.rec(
                source="drakenstein",
                institution="Drakenstein Municipality",
                sourceUrl=url,
                sourceTitle=f"Drakenstein Municipality tender opening {tender}",
                name=name,
                beeLevel=m.group(3),
                beeLevelRaw=f"L{m.group(3)}",
                tenderNumber=tender,
                tenderDescription=desc,
                awardDate=award,
                outcome="bidder_register",
            )
        )
    return rows


LEVEL_AFTER_POINTS = re.compile(
    r"([A-Z][A-Za-z0-9&.'’\-\(\)/,+ ]{3,90}?)\s*R\s*[\d][\d\s,]*\.\d{2}\s*(\d{1,3}\.\d{2})\s*([0-8])(\d{1,2})?"
)
LEVEL_BEFORE_POINTS = re.compile(
    r"([A-Z][A-Za-z0-9&.'’\-\(\)/,+ ]{3,90}?)\s*R\s*[\d][\d\s,]*\.\d{2}\s+([1-8])\s+(\d{1,3}\.\d{2})"
)
TENDER_RE = re.compile(
    r"TENDER\s+((?:T|L)\d+[./]\d+(?:[./]\d+)?)",
    re.I,
)
CONFIRM_RE = re.compile(
    rf"Confirmed by the Municipal Manager on\s+(\d{{1,2}}\s+(?:{MONTHS})\s+20\d{{2}})",
    re.I,
)
AWARD_RE = re.compile(
    r"be awarded to\s+(.+?)\s+for\b",
    re.I,
)


def parse_swartland(path: Path, url: str) -> list[dict]:
    reader = PdfReader(str(path), strict=False)
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if re.search(r"contribution|contri|b-?bbee|bbbee", text, re.I):
            pages.append(text)
    blob = "\n".join(pages)
    # Split on each tender heading so the confirmation date stays with that tender.
    parts = re.split(r"(?=TENDER\s+(?:T|L)\d)", blob, flags=re.I)
    rows = []
    for part in parts:
        tm = TENDER_RE.search(part)
        if not tm:
            continue
        tender = sp.collapse(tm.group(1)).replace(".", "/")
        confirmed = CONFIRM_RE.search(part)
        award = modern(confirmed.group(1) if confirmed else None)
        if not award:
            continue
        awarded_name = None
        am = AWARD_RE.search(re.sub(r"\s+", " ", part))
        if am:
            awarded_name = sp.norm_key(clean_bidder(am.group(1)))
        flat = re.sub(r"\s+", " ", part)
        seen_local = set()
        matches = []
        for m in LEVEL_BEFORE_POINTS.finditer(flat):
            matches.append((m.start(), m.group(1), m.group(2)))
        if not matches:
            for m in LEVEL_AFTER_POINTS.finditer(flat):
                level = m.group(3)
                if level == "0":
                    continue
                matches.append((m.start(), m.group(1), level))
        for _, raw_name, level in matches:
            if level == "0":
                continue
            name = accept_name(clean_bidder(raw_name))
            if not name:
                continue
            key = (sp.norm_key(name), level)
            if key in seen_local:
                continue
            seen_local.add(key)
            outcome = "awarded" if awarded_name and sp.norm_key(name) == awarded_name else "bidder_register"
            rows.append(
                sp.rec(
                    source="swartland",
                    institution="Swartland Municipality",
                    sourceUrl=url,
                    sourceTitle=f"Swartland Municipality council record {tender}",
                    name=name,
                    beeLevel=level,
                    beeLevelRaw=f"Contribution level {level}",
                    tenderNumber=tender,
                    tenderDescription=None,
                    awardDate=award,
                    outcome=outcome,
                )
            )
    return rows


DESC_SPLIT = re.compile(
    r"\b(Supply|Appointment|Replacement|Hire of|Manufacture|Provision of|Monitoring|"
    r"Collection|Rendering|Maintenance of|Upgrading of|Installation of|Transport of|"
    r"Design,|The supply|A service|Servicing|Cleaning of|Leasing|Construction of)\b",
    re.I,
)
BERG_ROW = re.compile(
    r"((?:T|FQ)\s*8/[23]/\d+\s*-\s*\d{4})\s+"
    r"(.+?)\s+"
    r"(?:Rates|R\s*[\d][\d\s,]*\.\d{2})\s+"
    r"(?:Rates|R\s*[\d][\d\s,]*\.\d{2})\s+"
    r"([1-8])\s+"
    r"(?:Competitive|Competetive|Quotation)\b",
    re.I,
)
BERG_DATE = re.compile(
    rf"(\d{{1,2}})-((?:{MONTHS}))-(\d{{4}})",
    re.I,
)


def parse_bergrivier(path: Path, url: str, label: str) -> list[dict]:
    text = pdf_text(path)
    if not re.search(r"B-BBEE\s+Status", text, re.I):
        return []
    flat = re.sub(r"\s+", " ", text)
    dated = BERG_DATE.search(flat)
    award = modern(dated.group(0).replace("-", " ") if dated else None)
    if not award:
        # "1-Oct-2025" may not match parse_date; try day month year explicitly
        if dated:
            award = modern(f"{dated.group(1)} {dated.group(2)} {dated.group(3)}")
    if not award:
        return []
    rows = []
    for m in BERG_ROW.finditer(flat):
        raw = sp.collapse(m.group(2))
        parts = DESC_SPLIT.split(raw, maxsplit=1)
        name = accept_name(clean_bidder(parts[0]))
        if not name:
            continue
        desc = None
        if len(parts) == 3:
            desc = sp.collapse(parts[1] + parts[2])[:240]
        tender = re.sub(r"\s+", "", m.group(1).upper())
        tender = tender.replace("T8/", "T 8/").replace("FQ8/", "FQ 8/")
        rows.append(
            sp.rec(
                source="bergrivier",
                institution="Bergrivier Municipality",
                sourceUrl=url,
                sourceTitle=f"Bergrivier Municipality award register {label}",
                name=name,
                beeLevel=m.group(3),
                beeLevelRaw=f"B-BBEE status level {m.group(3)}",
                tenderNumber=tender,
                tenderDescription=desc,
                awardDate=award,
                outcome="awarded",
            )
        )
    return rows


def to_corpus(rows: list[dict]) -> tuple[list[dict], Counter]:
    skipped = Counter()
    seen = set()
    by_name: dict[str, dict] = {}
    for r in rows:
        name = r["name"]
        if not r.get("beeLevel") or not r.get("awardDate"):
            skipped["undated_or_no_level"] += 1
            continue
        if r["awardDate"] < "2024-01-01":
            skipped["pre_2024"] += 1
            continue
        key = (sp.norm_key(name), r["sourceUrl"], r.get("tenderNumber") or "", r["beeLevel"])
        if key in seen:
            skipped["dup_row"] += 1
            continue
        seen.add(key)
        disclosure = {
            "sourceUrl": r["sourceUrl"],
            "governmentInstitution": r["institution"],
            "tenderNumber": r.get("tenderNumber"),
            "tenderDescription": r.get("tenderDescription"),
            "awardDate": r["awardDate"],
            "beeLevel": r["beeLevel"],
            "sourceTitle": r.get("sourceTitle"),
            "outcome": r.get("outcome") or "bidder_register",
        }
        disclosure = {k: v for k, v in disclosure.items() if v}
        nk = sp.norm_key(name)
        item = by_name.get(nk)
        if not item:
            by_name[nk] = {
                "canonicalName": name,
                "legalName": name,
                "publishIfSafe": True,
                "procurement": [disclosure],
            }
        else:
            if "(pty)" in name.lower() and "(pty)" not in item["canonicalName"].lower():
                item["canonicalName"] = name
                item["legalName"] = name
            item["procurement"].append(disclosure)
    items = []
    for item in by_name.values():
        item["procurement"] = item["procurement"][:8]
        items.append(item)
    return items, skipped


def main() -> None:
    rows: list[dict] = []
    docs = Counter()
    for name, url in DRAKENSTEIN.items():
        path = SRC / "drakenstein" / name
        if not path.exists():
            print("missing", path)
            continue
        parsed = parse_drakenstein(path, url)
        docs["drakenstein_docs"] += 1
        docs["drakenstein_rows"] += len(parsed)
        rows.extend(parsed)
        print(f"drakenstein {name}: {len(parsed)}")
    for name, url in SWARTLAND.items():
        path = SRC / "swartland" / name
        if not path.exists():
            print("missing", path)
            continue
        parsed = parse_swartland(path, url)
        docs["swartland_docs"] += 1
        docs["swartland_rows"] += len(parsed)
        rows.extend(parsed)
        print(f"swartland {name}: {len(parsed)}")
    manifest_path = OUT / "scale-batch-1-manifest.json"
    seen_url = {u for u in list(DRAKENSTEIN.values())}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for item in manifest:
            url = item.get("url")
            path = Path(item.get("path") or "")
            if not url or not path.exists() or url in seen_url:
                continue
            seen_url.add(url)
            family = item.get("family")
            if family == "drakenstein":
                parsed = parse_drakenstein(path, url)
                docs["drakenstein_docs"] += 1
                docs["drakenstein_rows"] += len(parsed)
            elif family == "bergrivier":
                parsed = parse_bergrivier(path, url, item.get("label") or path.name)
                docs["bergrivier_docs"] += 1
                docs["bergrivier_rows"] += len(parsed)
            else:
                continue
            rows.extend(parsed)
            print(f"{family} {item.get('label','')[:48]}: {len(parsed)}")
    items, skipped = to_corpus(rows)
    random.seed(1)
    sample = random.sample(rows, min(20, len(rows)))
    (OUT / "scale-batch-1.json").write_text(json.dumps(items))
    (OUT / "scale-batch-1-sample.json").write_text(json.dumps(sample, indent=2))
    summary = {
        "documents": dict(docs),
        "candidate_rows": len(rows),
        "unique_entities": len(items),
        "skipped": dict(skipped),
        "by_source": dict(Counter(r["source"] for r in rows)),
    }
    (OUT / "scale-batch-1-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
