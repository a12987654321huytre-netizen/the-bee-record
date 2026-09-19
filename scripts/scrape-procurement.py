#!/usr/bin/env python3
"""Extract official government procurement B-BBEE disclosures into corpus JSON."""
from __future__ import annotations

import json
import re
import html as html_lib
from collections import Counter, defaultdict
from pathlib import Path
from datetime import date

ROOT = Path("/workspace")
SRC = Path("/tmp/bee-sources")
OUT = ROOT / "data" / "procurement"
OUT.mkdir(parents=True, exist_ok=True)

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

JV_RE = re.compile(r"\b(jv|j/v|joint\s+ventures?|consortium|consortia)\b", re.I)
NOISE_NAME = re.compile(
    r"^(n/?a|none|tbc|tba|various|multiple|not\s+applicable|supplier|bidder|company|name of (the )?bidder|successful bidder|level\s*[1-8]|eme|qse|generic)$",
    re.I,
)
FRAG_START = re.compile(
    r"^(pty\)|ltd|cc|inc|limited|tion|ing|vices|tors|prise|tions|care|school|solutions|projects|manufacturers|surveyors|recruitment|and |of |the |for |to |new |all |jects|tects|prises|works )\b",
    re.I,
)
LEVEL_RE = re.compile(
    r"(?:b-?bb?ee(?:\s+level)?(?:\s+contributor)?|level(?:\s+contributor)?)\s*[:\-]?\s*(non[-\s]?compliant|[1-8]|one|two|three|four|five|six|seven|eight)\b",
    re.I,
)
BARE_LEVEL = re.compile(r"^level\s*([1-8]|non[-\s]?compliant)\b", re.I)
WORD_LEVEL = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8"}


def collapse(s: str) -> str:
    s = html_lib.unescape(s or "")
    s = s.replace("\xa0", " ").replace("\u2013", "-").replace("\u2014", "-")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_tags(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|tr|h\d|li|blockquote)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return collapse(s)


def parse_level(raw: str | None) -> str | None:
    if not raw:
        return None
    t = collapse(raw).lower()
    if "non" in t and "compliant" in t:
        return "non-compliant"
    m = re.search(r"\b([1-8])\b", t)
    if m:
        return m.group(1)
    m = re.search(r"\b(one|two|three|four|five|six|seven|eight)\b", t)
    if m:
        return WORD_LEVEL[m.group(1)]
    return None


def parse_date(raw: str | None) -> str | None:
    if not raw:
        return None
    t = collapse(raw)
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b", t)
    if m and m.group(2).lower()[:3] in MONTHS:
        mo = MONTHS[m.group(2).lower()[:3]] if len(m.group(2)) == 3 else MONTHS.get(m.group(2).lower(), MONTHS.get(m.group(2).lower()[:3]))
        if mo:
            return f"{m.group(3)}-{mo:02d}-{int(m.group(1)):02d}"
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", t)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y}-{mo:02d}-{d:02d}"
    return None


def clean_name(raw: str) -> str:
    s = collapse(raw)
    s = re.sub(r"\s*\(\s*pty\s*\)\s*ltd\.?", " (Pty) Ltd", s, flags=re.I)
    s = re.sub(r"\s+pty\.?\s*ltd\.?", " (Pty) Ltd", s, flags=re.I)
    s = re.sub(r"\s+limited\.?$", " Limited", s, flags=re.I)
    s = s.strip(" \t,.;:-")
    return s


CORE_STOP = {
    "institute", "national", "contractors", "agencies", "solutions", "projects",
    "manufacturers", "removals", "surveyors", "recruitment", "school", "care",
    "pty", "ltd", "limited", "cc", "inc", "ness", "prise", "tions", "company",
    "enterprise", "trading", "holdings", "group", "services", "consulting",
    "medical", "surgical", "engineers", "corporate", "events", "town", "roads",
    "plant", "tiles", "africa", "centers", "centre", "supplies", "construction",
    "consultants", "control", "engineering", "systems", "airconditioning",
    "renovators", "building", "port", "ment", "ments", "ers", "plies", "trol",
    "neers", "gineers", "neering", "tium", "terprise", "ogies", "lishers",
    "struction", "sultants", "sulting", "suplies", "contractors", "agencies",
    "sa", "rsa", "south", "general", "business", "management", "security",
    "cleaning", "transport", "logistics", "technology", "technologies",
    "communications", "investment", "investments", "properties", "property",
    "international", "africa", "african", "global", "united", "first", "new",
    "enterprises", "works",
}

FRAGMENT_STEMS = {
    "struction", "sultants", "sulting", "plies", "ments", "trol", "neers",
    "gineers", "neering", "tium", "terprise", "ogies", "lishers", "centers",
    "ment", "ers", "tiles", "trop", "prise", "tions", "ness", "vices", "tors",
    "ing", "tion", "suplies", "rica", "frica", "ntractors", "nstruction",
    "onsultants", "ngineers", "ervices", "olutions", "rojects", "nterprise",
    "olding", "oldings", "rading", "edical", "urgical", "orporate",
    "jects", "tects", "prises", "works",
}

DESC_PREFIX = re.compile(
    r"^(supply|deliver|appointment|provision|service of|bi-annual|single |dual |"
    r"hiring |lease |maintenance |repair |installation |rendering |dressing |"
    r"clear plastic|plate |aesculap|infrastructure |the supply|request for |"
    r"tender for |award of |description )",
    re.I,
)
LEGAL_TAIL = re.compile(
    r"([A-Z][A-Za-z0-9&.'’\-][A-Za-z0-9&.'’\- ]{1,50}"
    r"(?:\((?:Pty)\)\s*Ltd|Pty Ltd|PTY LTD|Limited|Ltd\.?|CC|Inc\.?))\s*$",
    re.I,
)


def salvage_name(raw: str) -> str:
    s = collapse(raw)
    s = re.sub(r"\s+Provinces\s*$", "", s, flags=re.I)
    s = re.sub(r"^Infrastructure\s+[A-Za-z]+-?\d{0,2}\s+", "", s, flags=re.I)
    s = re.sub(r"\s+Pty\s*\(\s*Ltd\s*\)", " (Pty) Ltd", s, flags=re.I)
    s = re.sub(r"\s*\([^)]*$", "", s).strip()
    func = {"and", "of", "the", "for", "with", "t/a", "ta", "a", "an", "to", "in", "as", "or", "on", "at", "by", "de"}
    toks = s.split()
    cut = 0
    for j, tok in enumerate(toks):
        prev = toks[j - 1] if j else ""
        if j >= 1 and tok[:1].isupper() and prev[:1].islower() and prev.lower() not in func:
            cut = j
    if cut >= 2:
        s = " ".join(toks[cut:])
    if DESC_PREFIX.match(s):
        tails = list(LEGAL_TAIL.finditer(s))
        if tails and tails[-1].start() > 6:
            s = collapse(tails[-1].group(1))
    return collapse(s)


def malformed(name: str) -> bool:
    t = collapse(name)
    if len(t) < 3 or len(t) > 90:
        return True
    if re.match(r"^https?:", t, re.I) or re.match(r"^\d+$", t):
        return True
    if NOISE_NAME.match(t):
        return True
    if not re.search(r"[A-Za-z]", t):
        return True
    if re.match(r"^r[\s]?\d", t, re.I):
        return True
    if len(t.split()) > 12:
        return True
    if t[0].islower():
        return True
    if FRAG_START.match(t):
        return True
    if re.search(r"\bLEVEL\s*[1-8]\b|\b20\d{2}\b|R[\s]?\d{2,}|DATE AWARDED|BBBEE LEVEL|CONTRACT NUMBER", t, re.I):
        return True
    if re.match(r"^[^A-Za-z]*Pty\)", t, re.I):
        return True
    if DESC_PREFIX.match(t) or re.search(r"\bx\s*\d+\b", t):
        return True
    if re.search(r"\bProvinces\b", t, re.I):
        return True
    if re.match(r"^[A-Z]{2,6}\d{4,}", t):
        return True
    letters = re.sub(r"[^A-Za-z]", "", t)
    if len(letters) < 6:
        return True
    core = re.sub(r"\b(pty|ltd|limited|inc|cc|proprietary)\b", " ", t, flags=re.I)
    core = re.sub(r"[^A-Za-z0-9& ]+", " ", core)
    core = re.sub(r"\s+", " ", core).strip()
    if not core or core.lower() in CORE_STOP:
        return True
    core_letters = re.sub(r"[^A-Za-z]", "", core)
    if len(core_letters) < 4:
        return True
    words = core.split()
    if all(w.lower() in CORE_STOP or w.lower() in FRAGMENT_STEMS or len(w) < 3 for w in words):
        return True
    first = words[0].lower()
    if first in FRAGMENT_STEMS:
        return True
    if len(words) == 1 and (first in CORE_STOP or first in FRAGMENT_STEMS or len(first) < 5):
        return True
    return False


def is_jv(name: str) -> bool:
    t = collapse(name)
    if JV_RE.search(t):
        return True
    if " / " in t and re.search(r"\b(pty|ltd|limited|inc|cc)\b", t, re.I):
        parts = t.split(" / ")
        if len(parts) >= 2 and re.search(r"\b(pty|ltd|limited|inc|cc)\b", parts[1], re.I):
            return True
    return False


def tables(html: str) -> list[list[list[str]]]:
    out = []
    for m in re.finditer(r"<table\b[\s\S]*?</table>", html, re.I):
        rows = []
        for tr in re.finditer(r"<tr\b[\s\S]*?</tr>", m.group(0), re.I):
            cells = [strip_tags(c) for c in re.findall(r"<t[dh]\b[\s\S]*?</t[dh]>", tr.group(0), re.I)]
            cells = [c for c in cells]
            if any(cells):
                rows.append(cells)
        if rows:
            out.append(rows)
    return out


def header_map(row: list[str]) -> dict[str, int]:
    idx = {}
    for i, cell in enumerate(row):
        k = collapse(cell).lower()
        if re.search(r"name of (the )?(bidder|supplier)|bidder|supplier|service provider|company", k) and "amount" not in k:
            idx.setdefault("name", i)
        elif re.search(r"b-?bb?ee|bee level|level contribution", k):
            idx.setdefault("level", i)
        elif re.search(r"eme|qse|enterprise|generic|gen\b|class", k):
            idx.setdefault("class", i)
        elif re.search(r"amount|price|quoted", k):
            idx.setdefault("amount", i)
        elif re.search(r"tender|bid\s*(no|number)|rf[bq]", k):
            idx.setdefault("tender", i)
        elif re.search(r"date|award", k):
            idx.setdefault("date", i)
        elif re.search(r"period|duration", k):
            idx.setdefault("period", i)
        elif re.search(r"description", k):
            idx.setdefault("desc", i)
    return idx


def rec(**kwargs):
    kwargs["retrieved"] = date.today().isoformat()
    return kwargs


# ---------- Justice ----------
def parse_justice(path: Path) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    blocks = re.split(r'(?i)<p class="btn-primary">|<strong>Awarded:', html)
    current_tender = None
    current_desc = None
    for block in blocks[1:]:
        text = strip_tags(block)
        m = re.search(r"(RF[BQ]\s*\d+\s*\d{4})", text, re.I)
        if m:
            current_tender = collapse(m.group(1))
        desc_m = re.search(r"(RF[BQ]\s*\d+\s*\d{4}\s*[:\-–].{10,240})", text, re.I)
        if desc_m:
            current_desc = collapse(desc_m.group(1))[:240]
        names = re.findall(r"Name of the\s*Supplier\s*:?\s*(.+)", text, re.I)
        levels = re.findall(r"BBB?-?EE Level\s*:?\s*([^\n]+)", text, re.I)
        classes = re.findall(r"Enterprise Type\s*:?\s*([^\n]+)", text, re.I)
        dates = re.findall(r"Dated\s*:?\s*([^\n]+)", text, re.I)
        amounts = re.findall(r"Awarded\s+Amount\s*:?\s*([^\n]+)", text, re.I)
        periods = re.findall(r"Contract Period\s*:?\s*([^\n]+)", text, re.I)
        n = max(len(names), 1 if "Supplier" in text else 0)
        # Split supplier records by repeating "Name of the Supplier"
        parts = re.split(r"(?i)Name of the\s*Supplier\s*:", text)
        if len(parts) <= 1:
            continue
        header = parts[0]
        tnum = current_tender
        tm = re.search(r"(RF[BQ]\s*\d+\s*\d{4})", header, re.I)
        if tm:
            tnum = collapse(tm.group(1))
        tdesc = current_desc
        dm = re.search(r"(RF[BQ][\s\S]{0,240})", header, re.I)
        if dm:
            tdesc = collapse(dm.group(1))[:240]
        for part in parts[1:]:
            name = collapse(part.split("Awarded")[0].split("\n")[0])
            level = None
            lm = re.search(r"BBB?-?EE Level\s*:?\s*([A-Za-z0-9 \-]+)", part, re.I)
            if lm:
                level = parse_level(lm.group(1))
            klass = None
            cm = re.search(r"Enterprise Type\s*:?\s*([A-Za-z]+)", part, re.I)
            if cm:
                klass = collapse(cm.group(1)).upper()
            dt = None
            dm2 = re.search(r"Dated\s*:?\s*([A-Za-z0-9 ]+)", part, re.I)
            if dm2:
                dt = parse_date(dm2.group(1))
            amt = None
            am = re.search(r"Awarded\s+Amount\s*:?\s*(R[\d\s,\.]+)", part, re.I)
            if am:
                amt = collapse(am.group(1))
            per = None
            pm = re.search(r"Contract Period\s*:?\s*([^\n]+)", part, re.I)
            if pm:
                per = collapse(pm.group(1))[:80]
            if not name:
                continue
            rows.append(rec(
                source="justice",
                institution="Department of Justice and Constitutional Development",
                sourceUrl="https://www.justice.gov.za/cfo_tender/tenders-awarded.html",
                sourceTitle="DoJCD Bids/Tenders Awarded",
                name=clean_name(name),
                beeLevel=level,
                beeLevelRaw=lm.group(1).strip() if lm else None,
                enterpriseClass=klass,
                tenderNumber=tnum,
                tenderDescription=tdesc,
                awardDate=dt,
                contractAmount=amt,
                contractPeriod=per,
                outcome="awarded",
            ))
    return rows


# ---------- Treasury awarded HTML ----------
def parse_treasury_awarded(path: Path) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    # Work section by tender heading NT###
    chunks = re.split(r"(?i)(NT\d[\d\-]+)", html)
    # pairs: after split, odd indices are tender numbers if they matched
    i = 1
    while i < len(chunks) - 1:
        tender = collapse(chunks[i])
        body = chunks[i + 1]
        desc = None
        dm = re.search(r"(?:<b>|<strong>|<p>)([^<]{12,180})", body, re.I)
        if dm:
            desc = collapse(dm.group(1))
        for tbl in tables(body)[:12]:
            if len(tbl) < 2:
                continue
            hm = header_map(tbl[0])
            if "name" not in hm:
                # maybe header is second row
                hm = header_map(tbl[1]) if len(tbl) > 1 else {}
                data_rows = tbl[2:] if "name" in hm else []
            else:
                data_rows = tbl[1:]
            if "name" not in hm:
                continue
            for r in data_rows:
                name = r[hm["name"]] if hm["name"] < len(r) else ""
                level = None
                if "level" in hm and hm["level"] < len(r):
                    level = parse_level(r[hm["level"]])
                    raw = r[hm["level"]]
                else:
                    raw = None
                    joined = " ".join(r)
                    level = parse_level(joined) if re.search(r"level", joined, re.I) else None
                if not name or not re.search(r"[A-Za-z]", name):
                    continue
                if re.search(r"name of bidder|b-?bbee level", name, re.I):
                    continue
                rows.append(rec(
                    source="treasury_awarded",
                    institution="National Treasury",
                    sourceUrl="https://www.treasury.gov.za/tenderinfo/awarded/",
                    sourceTitle="National Treasury — Information on Tenders awarded",
                    name=clean_name(name),
                    beeLevel=level,
                    beeLevelRaw=raw,
                    tenderNumber=tender,
                    tenderDescription=desc,
                    outcome="awarded",
                    enterpriseClass=r[hm["class"]] if "class" in hm and hm["class"] < len(r) else None,
                    contractAmount=r[hm["amount"]] if "amount" in hm and hm["amount"] < len(r) else None,
                ))
        i += 2
    return rows


# ---------- DSTI supplier pages ----------
def parse_dsti_page(path: Path, page_id: str) -> list[dict]:
    html = path.read_text(errors="replace")
    if "B-BBEE Level" not in html and "Level 1 contributor" not in html and "Level 2 contributor" not in html:
        return []
    tender = None
    tm = re.search(r"(DSTI\d+[A-Z]?/\d{4}-\d{2})", html)
    if tm:
        tender = tm.group(1)
    desc = None
    dm = re.search(r"Appointment of .{20,220}", html, re.I)
    if dm:
        desc = collapse(strip_tags(dm.group(0)))[:240]
    closed = None
    for pat in [
        r"closing date of ([^.<]+)",
        r"Submissions closed on ([^,<]+)",
        r"Published:\s*<!--\s*-->\s*([A-Za-z0-9 ]+)",
        r"Published:</[^>]+>\s*([A-Za-z0-9 ]+)",
    ]:
        cm = re.search(pat, html, re.I)
        if cm:
            closed = parse_date(cm.group(1))
            if closed:
                break
    rows = []
    pattern = re.compile(
        r'<td class="px-6 py-4 font-medium text-gray-900">([^<]+)</td>'
        r'[\s\S]{0,500}?'
        r'(Level\s*[1-8]\s*contributor|Non-compliant(?:\s*contributor)?)',
        re.I,
    )
    for m in pattern.finditer(html):
        name = clean_name(m.group(1))
        level = parse_level(m.group(2))
        rows.append(rec(
            source="dsti",
            institution="Department of Science, Technology and Innovation",
            sourceUrl=f"https://www.dsti.gov.za/about/suppliers/{page_id}",
            sourceTitle=f"DSTI suppliers — {tender or page_id}",
            name=name,
            beeLevel=level,
            beeLevelRaw=collapse(m.group(2)),
            tenderNumber=tender,
            tenderDescription=desc,
            awardDate=closed,
            outcome="responded",
        ))
    return rows


# ---------- DBE awarded ----------
def parse_dbe(path: Path) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    # Split by tender heading blocks
    parts = re.split(r'(?i)<div class="well[^"]*">', html)
    for part in parts[1:]:
        heading = strip_tags(part[:800])
        tender = None
        tm = re.search(r"(DBE\s*\d+[A-Z]?)", heading, re.I)
        if tm:
            tender = collapse(tm.group(1))
        desc = collapse(heading)[:240]
        body_tables = tables(part)
        for tbl in body_tables[:6]:
            if len(tbl) < 2:
                continue
            hm = header_map(tbl[0])
            if "name" not in hm:
                continue
            if "level" not in hm and not re.search(r"b-?bb?ee", " ".join(tbl[0]), re.I):
                continue
            for r in tbl[1:]:
                name = r[hm["name"]] if hm["name"] < len(r) else ""
                level = parse_level(r[hm["level"]]) if "level" in hm and hm["level"] < len(r) else parse_level(" ".join(r))
                if not name:
                    continue
                rows.append(rec(
                    source="dbe",
                    institution="Department of Basic Education",
                    sourceUrl="https://www.education.gov.za/Tenders/AwardedTenders.aspx",
                    sourceTitle="DBE Awarded Tenders",
                    name=clean_name(name),
                    beeLevel=level,
                    tenderNumber=tender,
                    tenderDescription=desc,
                    outcome="awarded",
                    contractAmount=r[hm["amount"]] if "amount" in hm and hm["amount"] < len(r) else None,
                ))
    return rows


# ---------- OSTB awarded HTML ----------
def parse_ostb(path: Path) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    current_tender = None
    current_desc = None
    current_period = None
    for tbl in tables(html):
        if not tbl:
            continue
        hm = header_map(tbl[0])
        if "name" not in hm and "level" not in hm:
            # heading table?
            joined = " ".join(tbl[0])
            tm = re.search(r"(RT[\d\-]+|NT[\d\-]+)", joined, re.I)
            if tm:
                current_tender = tm.group(1)
            if len(joined) > 20:
                current_desc = collapse(joined)[:240]
            continue
        if "name" not in hm:
            continue
        for r in tbl[1:]:
            name = r[hm["name"]] if hm["name"] < len(r) else ""
            level = parse_level(r[hm["level"]]) if "level" in hm and hm["level"] < len(r) else parse_level(" ".join(r))
            if not name:
                continue
            rows.append(rec(
                source="ostb",
                institution="National Treasury — OCPO",
                sourceUrl="https://www.treasury.gov.za/divisions/ocpo/ostb/Information%20on%20Tenders%20Awarded/Information%20on%20Tenders%20Awarded.aspx",
                sourceTitle="OCPO Information on Tenders Awarded",
                name=clean_name(name),
                beeLevel=level,
                tenderNumber=current_tender,
                tenderDescription=current_desc,
                contractPeriod=r[hm["period"]] if "period" in hm and hm["period"] < len(r) else current_period,
                outcome="awarded",
            ))
    return rows


# ---------- SARS awarded HTML ----------
def parse_sars_html(path: Path, page_url: str) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    for tbl in tables(html):
        if len(tbl) < 2:
            continue
        # header may be two rows
        hm = header_map(tbl[0])
        start = 1
        if "name" not in hm and len(tbl) > 1:
            hm = header_map(tbl[1])
            start = 2
        if "name" not in hm:
            # SARS uses "Supplier"
            for i, cell in enumerate(tbl[0]):
                k = collapse(cell).lower()
                if k.startswith("supplier") or k == "supplier:":
                    hm["name"] = i
                elif "bbbee level" in k or k == "bbbee level":
                    hm["level"] = i
                elif k.startswith("reference"):
                    hm["tender"] = i
                elif k.startswith("description"):
                    hm["desc"] = i
                elif "date of award" in k or k == "date of award.":
                    hm["date"] = i
                elif "contract period" in k:
                    hm["period"] = i
                elif "contract price" in k:
                    hm["amount"] = i
            if "name" not in hm:
                continue
        for r in tbl[start:]:
            name = r[hm["name"]] if hm["name"] < len(r) else ""
            if not name or re.search(r"reference number|supplier", name, re.I):
                continue
            raw_level = r[hm["level"]] if "level" in hm and hm["level"] < len(r) else ""
            level = parse_level(raw_level)
            if not level and re.search(r"qse|eme", raw_level or "", re.I):
                # enterprise class only — not a B-BBEE level
                continue
            rows.append(rec(
                source="sars",
                institution="South African Revenue Service",
                sourceUrl=page_url,
                sourceTitle="SARS Awarded Tenders",
                name=clean_name(name),
                beeLevel=level,
                beeLevelRaw=raw_level or None,
                tenderNumber=r[hm["tender"]] if "tender" in hm and hm["tender"] < len(r) else None,
                tenderDescription=(r[hm["desc"]] if "desc" in hm and hm["desc"] < len(r) else None),
                awardDate=parse_date(r[hm["date"]]) if "date" in hm and hm["date"] < len(r) else None,
                contractPeriod=r[hm["period"]] if "period" in hm and hm["period"] < len(r) else None,
                contractAmount=r[hm["amount"]] if "amount" in hm and hm["amount"] < len(r) else None,
                outcome="awarded",
            ))
    return rows


def pdf_text(path: Path, max_pages: int | None = None) -> str:
    import warnings
    warnings.filterwarnings("ignore")
    from pypdf import PdfReader
    r = PdfReader(str(path), strict=False)
    pages = r.pages if max_pages is None else r.pages[:max_pages]
    return "\n".join((p.extract_text() or "") for p in pages)


# ---------- Health successful-supplier PDFs ----------
def parse_health_pdf(path: Path) -> list[dict]:
    try:
        text = pdf_text(path)
    except Exception:
        return []
    if not re.search(r"Contribution Level|B-BBEE Points", text, re.I):
        return []
    tender = None
    tm = re.search(r"(HP\d{2}-\d{4}[A-Z]{2,4}(?:/\d+)?)", text)
    if tm:
        tender = tm.group(1)
    desc = None
    dm = re.search(r"(SUPPLY AND DELIVERY OF[^\n]{10,180})", text, re.I)
    if dm:
        desc = collapse(dm.group(1))[:240]
    period = None
    pm = re.search(r"PERIOD\s+([0-9][^\n]{10,80})", text, re.I)
    if pm:
        period = collapse(pm.group(1))[:80]
    url = "https://www.health.gov.za/wp-content/uploads/" + path.name
    # Prefer reconstructing from known harvest names; path name is the filename.
    rows = []
    # Name ... MAAA######## ... (level | Non-compliant...)
    pat = re.compile(
        r"([A-Z][A-Za-z0-9&.'\-\(\)/ ]{3,90}?)\s+(MAAA\d{5,10})\s+\S+\s+"
        r"(Non[-\s]?compliant(?:\s+contributor)?|NON[-\s]?COMPLIANT(?:\s+CONTRIBUTOR)?|Non-B-BBEE Contributor|[1-8])\b",
        re.I,
    )
    for m in pat.finditer(text):
        name = clean_name(m.group(1))
        name = re.sub(r"^(Supplier Name|Successful Suppliers)\s+", "", name, flags=re.I)
        level = parse_level(m.group(3))
        rows.append(rec(
            source="health",
            institution="National Department of Health",
            sourceUrl=f"https://www.health.gov.za/tenders/",
            sourceTitle=f"NDoH successful suppliers — {tender or path.stem}",
            name=name,
            beeLevel=level,
            beeLevelRaw=collapse(m.group(3)),
            tenderNumber=tender,
            tenderDescription=desc,
            contractPeriod=period,
            outcome="awarded",
        ))
    return rows


WC_MONTH_URL = "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2025-05/{month}-2024-award-fy2425.pdf&type=file"
WC_EXTRA_URLS = {
    "may2023.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20May%202023_0.pdf&type=file",
    "june2023.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20June%202023_0.pdf&type=file",
    "nov2023.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-04/November%202023%20Awards.pdf&type=file",
    "april2023-a.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20April%202023_0.pdf&type=file",
    "july2023-a.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20July%202023_0.pdf&type=file",
    "august2023-a.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-01/Contract%20Awards%20-%20August%202023_0.pdf&type=file",
    "december2023-b.pdf": "https://www.westerncape.gov.za/infrastructure/files/wcg-blob-files?file=2024-04/December%202023%20Awards.pdf&type=file",
}


def parse_wc_compact(text: str, source_url: str, title: str) -> list[dict]:
    """2023-style single-block rows: NAME CONTRACT DESC amountR LEVEL."""
    blob = re.sub(r"\s+", " ", text)
    blob = re.sub(r"SUCCESSFUL BIDDER.*?CONTRIBUTOR", " ", blob, flags=re.I)
    pat = re.compile(
        r"([A-Z][A-Za-z0-9&.'’\-/ ]{2,70}?)\s+"
        r"([A-Z]\d{2,4}/\d{2}(?:-[A-Z0-9.]+)?(?:\s+\([^)]{0,40}\))?)\s+"
        r"(.+?)\s+"
        r"([\d,]+\.\d{2})\s*R\s+"
        r"(?:(-)|([1-8]))\b",
    )
    rows = []
    for m in pat.finditer(blob):
        name = collapse(m.group(1))
        name = re.sub(r"^(SUCCESSFUL BIDDER|CONTRACT NUMBER|DESCRIPTION OF CONTRACT.*)\s+", "", name, flags=re.I)
        if not name or len(name) < 3:
            continue
        level = None if m.group(5) else m.group(6)
        if not level:
            continue
        dt = parse_date(m.group(3))
        rows.append(rec(
            source="wc_infrastructure",
            institution="Western Cape Department of Infrastructure",
            sourceUrl=source_url,
            sourceTitle=title,
            name=clean_name(name),
            beeLevel=level,
            beeLevelRaw=level,
            tenderNumber=collapse(m.group(2)),
            tenderDescription=collapse(m.group(3))[:240],
            awardDate=dt,
            contractAmount="R" + m.group(4),
            outcome="awarded",
        ))
    return rows


def parse_wc_pdf(path: Path) -> list[dict]:
    try:
        text = pdf_text(path)
    except Exception:
        return []
    if "BBBEE LEVEL" not in text.upper() and "B-BBEE" not in text.upper():
        return []
    month = None
    for m in ["january","february","march","april","may","june","july","august","september","october","november","december"]:
        if m in path.name.lower():
            month = m
            break
    source_url = WC_EXTRA_URLS.get(path.name) or WC_MONTH_URL.format(month=month or "june")
    title = f"Western Cape Infrastructure awards — {month or path.stem}"
    blob = re.sub(r"\s+", " ", text)
    splitter = re.compile(r"(LEVEL\s*[1-8]|NON[-\s]?CONTRIBUTOR)", re.I)
    parts = splitter.split(blob)
    rows = []
    for i in range(1, len(parts), 2):
        level_raw = parts[i]
        prev = parts[i - 1].strip()
        amt = re.search(r"(R[\d\s,]+\.\d{2})\s*$", prev)
        if not amt:
            continue
        prev = prev[: amt.start()].strip()
        dt = re.search(r"(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s*$", prev)
        if not dt:
            continue
        prev = prev[: dt.start()].strip()
        cm = None
        for m in re.finditer(r"\b([A-Z]\d{2,4}/\d{2}(?:-[A-Z0-9]+)?)\b", prev):
            cm = m
        if not cm:
            continue
        name = collapse(prev[: cm.start()])
        name = re.sub(r"^(SUCCESSFUL BIDDER|CONTRACT NUMBER|DESCRIPTION OF CONTRACT.*BBBEE LEVEL)\s+", "", name, flags=re.I)
        # if leftover description words, keep the trailing proper-name phrase
        if len(name.split()) > 8:
            toks = name.split()
            cut = 0
            for j, tok in enumerate(toks):
                if tok[:1].isupper() and j >= 1 and toks[j - 1][:1].islower():
                    cut = j
            if cut:
                name = " ".join(toks[cut:])
        desc = collapse(prev[cm.end():])[:240]
        rows.append(rec(
            source="wc_infrastructure",
            institution="Western Cape Department of Infrastructure",
            sourceUrl=source_url,
            sourceTitle=title,
            name=clean_name(name),
            beeLevel=parse_level(level_raw),
            beeLevelRaw=collapse(level_raw),
            tenderNumber=collapse(cm.group(1)),
            tenderDescription=desc or None,
            awardDate=parse_date(dt.group(1)),
            contractAmount=collapse(amt.group(1)),
            outcome="awarded",
        ))
    if len(rows) < 5:
        extra = parse_wc_compact(text, source_url, title)
        if len(extra) > len(rows):
            rows = extra
    return rows


def parse_bulletin_pdf(path: Path) -> list[dict]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path), strict=False)
    except Exception:
        return []
    # Results are in the back half
    start = max(0, int(len(reader.pages) * 0.55))
    text = "\n".join((p.extract_text() or "") for p in reader.pages[start:])
    idx = text.upper().find("RESULTS OF TENDER")
    if idx >= 0:
        text = text[idx:]
    if not re.search(r"AWARDED TO|B-BEEE|B-BBEE", text, re.I):
        return []
    year = None
    ym = re.search(r"(20\d{2})", path.name)
    if ym:
        year = ym.group(1)
    num = path.stem
    url = f"https://www.treasury.gov.za/divisions/ocpo/ostb/bulletins/{year or '2016'}/{path.stem.split('-')[-1]}.pdf"
    rows = []
    # Company with legal suffix, rand amount, then BEE digit or Level N
    pat = re.compile(
        r"([A-Z][A-Za-z0-9&.'’\-\(\) ]{3,70}?(?:\((?:PTY)\)\s*LTD|Pty Ltd|PTY LTD|Limited|Ltd\.?|CC|Inc\.?))\s+"
        r"R[\s]*[\d][\d\s,]*(?:\.\d{2})?\s+"
        r"(?:LEVEL\s*)?([1-8]|non[-\s]?compliant)\b",
        re.I,
    )
    for m in pat.finditer(text):
        name = clean_name(m.group(1))
        # skip boilerplate
        if re.search(r"government printing|tender bulletin|awarded to|description", name, re.I):
            continue
        rows.append(rec(
            source="tender_bulletin",
            institution="Government Tender Bulletin (National Treasury / GPW)",
            sourceUrl=url,
            sourceTitle=f"Government Tender Bulletin {num}",
            name=name,
            beeLevel=parse_level(m.group(2)),
            beeLevelRaw=collapse(m.group(2)),
            outcome="awarded",
        ))
    return rows


def load_existing_names() -> set[str]:
    path = ROOT / "data" / "existing-entities.tsv"
    names = set()
    if not path.exists():
        return names
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            names.add(norm_key(parts[1]))
        names.add(norm_key(parts[0].replace("-", " ")))
    return names


def norm_key(name: str) -> str:
    s = collapse(name).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\b(pty|ltd|limited|inc|incorporated|proprietary|co|company|holdings|group|the)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    all_rows: list[dict] = []
    justice = SRC / "justice-awarded.html"
    if justice.exists():
        all_rows.extend(parse_justice(justice))
    treas = SRC / "treasury-awarded.html"
    if treas.exists():
        all_rows.extend(parse_treasury_awarded(treas))
    ostb = SRC / "treasury-ostb-awarded.html"
    if ostb.exists():
        all_rows.extend(parse_ostb(ostb))
    dbe = SRC / "dbe-awarded.html"
    if dbe.exists():
        all_rows.extend(parse_dbe(dbe))
    dsti_dir = SRC / "dsti"
    if dsti_dir.exists():
        for p in sorted(dsti_dir.glob("p*.html")):
            pid = p.stem[1:]
            if p.stat().st_size < 20000:
                continue
            all_rows.extend(parse_dsti_page(p, pid))
    sars_dir = SRC / "sars"
    if sars_dir.exists():
        for p in sorted(sars_dir.glob("*.html")):
            url = "https://www.sars.gov.za/procurement/awarded-tenders/"
            if p.stem.endswith("-2"):
                url = "https://www.sars.gov.za/procurement/awarded-tenders/page/2/"
            elif p.stem.endswith("-3"):
                url = "https://www.sars.gov.za/procurement/awarded-tenders/page/3/"
            elif p.stem.endswith("-4"):
                url = "https://www.sars.gov.za/procurement/awarded-tenders/page/4/"
            elif p.stem.endswith("-5"):
                url = "https://www.sars.gov.za/procurement/awarded-tenders/page/5/"
            elif p.stem.endswith("-6"):
                url = "https://www.sars.gov.za/procurement/awarded-tenders/page/6/"
            elif "2024" in p.stem:
                url = "https://www.sars.gov.za/procurement/awarded-tenders/5/"
            elif "2023" in p.stem:
                url = "https://www.sars.gov.za/procurement/awarded-tenders/4/"
            all_rows.extend(parse_sars_html(p, url))
    health_dir = SRC / "health"
    if health_dir.exists():
        for p in sorted(health_dir.glob("*.pdf")):
            all_rows.extend(parse_health_pdf(p))
    wc_dir = SRC / "wc"
    if wc_dir.exists():
        seen_sz = set()
        for p in sorted(wc_dir.glob("*.pdf")):
            sz = p.stat().st_size
            if sz in seen_sz:
                continue
            seen_sz.add(sz)
            all_rows.extend(parse_wc_pdf(p))
    bull_dir = SRC / "bulletins"
    if bull_dir.exists():
        for p in sorted(bull_dir.glob("*.pdf")):
            if p.stat().st_size < 50_000:
                continue
            all_rows.extend(parse_bulletin_pdf(p))

    stats = Counter(r["source"] for r in all_rows)
    print("RAW", dict(stats), "total", len(all_rows))

    existing = load_existing_names()
    catalogue = []
    skipped = Counter()
    # unique by name+sourceUrl+tender+level
    seen = set()
    corpus_by_name: dict[str, dict] = {}

    for r in all_rows:
        name = salvage_name(clean_name(r.get("name") or ""))
        if not name:
            skipped["empty"] += 1
            continue
        if is_jv(name):
            skipped["jv"] += 1
            continue
        if malformed(name):
            skipped["malformed"] += 1
            continue
        if not r.get("beeLevel"):
            skipped["no_level"] += 1
            continue
        key = (norm_key(name), r["sourceUrl"], r.get("tenderNumber") or "", r.get("beeLevel") or "")
        if key in seen:
            skipped["dup_row"] += 1
            continue
        seen.add(key)
        catalogue.append({**r, "name": name})
        nk = norm_key(name)
        item = corpus_by_name.get(nk)
        disclosure = {
            "sourceUrl": r["sourceUrl"],
            "governmentInstitution": r["institution"],
            "tenderNumber": r.get("tenderNumber") or None,
            "tenderDescription": r.get("tenderDescription") or None,
            "awardDate": r.get("awardDate") or None,
            "beeLevel": r.get("beeLevel"),
            "enterpriseClass": r.get("enterpriseClass") or None,
            "contractPeriod": r.get("contractPeriod") or None,
            "contractAmount": r.get("contractAmount") or None,
            "sourceTitle": r.get("sourceTitle") or None,
            "outcome": r.get("outcome") or "awarded",
        }
        # drop Nones
        disclosure = {k: v for k, v in disclosure.items() if v is not None}
        if not item:
            item = {
                "canonicalName": name,
                "legalName": name,
                "publishIfSafe": True,
                "procurement": [disclosure],
                "_source": r["source"],
                "_existing": nk in existing,
            }
            corpus_by_name[nk] = item
        else:
            # keep longer/legal-looking name
            if "pty" in name.lower() and "pty" not in item["canonicalName"].lower():
                item["canonicalName"] = name
                item["legalName"] = name
            item["procurement"].append(disclosure)

    for item in corpus_by_name.values():
        rows = item["procurement"]
        # Prefer dated, then awarded, then unique institution; cap at API max of 8.
        def rank(d):
            return (
                0 if d.get("awardDate") else 1,
                0 if d.get("outcome") == "awarded" else 1,
                d.get("awardDate") or "",
                d.get("tenderNumber") or "",
            )
        rows.sort(key=rank)
        seen_d = set()
        kept = []
        for d in rows:
            k = (d.get("sourceUrl"), d.get("tenderNumber"), d.get("beeLevel"), d.get("awardDate"))
            if k in seen_d:
                continue
            seen_d.add(k)
            kept.append(d)
            if len(kept) >= 8:
                break
        item["procurement"] = kept

    new_items = [v for v in corpus_by_name.values() if not v["_existing"]]
    existing_add = [v for v in corpus_by_name.values() if v["_existing"]]
    for v in new_items + existing_add:
        v.pop("_source", None)
        v.pop("_existing", None)

    (OUT / "candidates.json").write_text(json.dumps(catalogue, indent=2))
    (OUT / "corpus-new.json").write_text(json.dumps(new_items, indent=2))
    (OUT / "corpus-existing.json").write_text(json.dumps(existing_add, indent=2))
    summary = {
        "raw": dict(stats),
        "raw_total": len(all_rows),
        "skipped": dict(skipped),
        "unique_entities": len(corpus_by_name),
        "new_entities": len(new_items),
        "existing_entities_extra_evidence": len(existing_add),
        "candidate_rows": len(catalogue),
        "new_with_level": sum(1 for i in new_items if i["procurement"][0].get("beeLevel")),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print("sources new", Counter(
        (i["procurement"][0]["governmentInstitution"] for i in new_items)
    ))


if __name__ == "__main__":
    main()
