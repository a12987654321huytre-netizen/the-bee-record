#!/usr/bin/env python3
"""Parse harvested 2024-2026 municipal award registers into corpus JSON."""
from __future__ import annotations

import importlib.util
import json
import re
from collections import Counter
from pathlib import Path

spec = importlib.util.spec_from_file_location("sp", "/workspace/scripts/scrape-procurement.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

from pypdf import PdfReader

ROOT = Path("/workspace")
SRC = Path("/tmp/bee-sources/modern")
OUT = ROOT / "data" / "procurement"


def pdf_text(path: Path) -> str:
    r = PdfReader(str(path), strict=False)
    return "\n".join((p.extract_text() or "") for p in r.pages)


def looks_like_person(name: str) -> bool:
    t = sp.collapse(name)
    if re.search(r"\b(pty|ltd|limited|cc|inc|nv|npc|soc|rf|t/a|trading|construction|services|consult|group|holdings|enterprises?|projects|engineers?|solutions|suppliers?|security|electrical|civils?|attorneys)\b", t, re.I):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z'’\-]+", t)
    if 1 <= len(words) <= 4 and all(w[:1].isupper() for w in words):
        # two/three proper names with no legal suffix
        if not re.search(r"\d", t) and len(words) <= 3:
            return True
    return False


def salvage_trading(name: str) -> str:
    t = sp.collapse(name)
    t = re.sub(r"^N/?A\s+", "", t, flags=re.I)
    t = re.sub(r"^Financial Services[A-Za-z &/]*Management\s+", "", t, flags=re.I)
    t = re.sub(r"^MLM/[A-Z0-9/]+\s+R[\s\d,]+\.?\d*\s+", "", t, flags=re.I)
    t = re.sub(r"^K20\d{7,}\s*\([^)]*\)\s*(?:Pty\)?\s*Ltd)?\s*(?:t/a\s*)?", "", t, flags=re.I)
    m = re.search(r"\bt/a\s+(.+)$", t, re.I)
    if re.match(r"^K20\d{7,}", t) and m:
        t = m.group(1)
    return sp.collapse(t)


def extra_reject(name: str) -> bool:
    t = sp.collapse(name)
    if re.search(r"\bN/?A\b", t):
        return True
    if re.search(r"\ba division of\b", t, re.I):
        return True
    if re.match(r"^(K20\d{7,}|\d{4,}|MLM/|BSM\s|SC\d|TECH |REF )", t, re.I):
        return True
    if t.count("(Pty)") > 1 or t.lower().count(" pty") > 1:
        return True
    # glued stationers / brand universe garbage
    if t.lower().count(" n/a ") >= 1:
        return True
    if re.search(r"R[\s]?\d{2,}", t):
        return True
    if "Western Vape" in t:
        return True
    if re.search(r"\b(ANDRE DU PLESSIS|A DU PLESSIS|PETRUS JOHANNES|ARINA WILSON)\b", t, re.I):
        return True
    return False


def modern_date(raw: str | None, fallback_year: int | None = None) -> str | None:
    d = sp.parse_date(raw)
    if d and d >= "2024-01-01":
        return d
    if d and d < "2024-01-01":
        return None
    if fallback_year and fallback_year >= 2024:
        return str(fallback_year)
    return None


def year_from_tender(tender: str) -> int | None:
    m = re.search(r"(20[2-3]\d)", tender or "")
    if m:
        y = int(m.group(1))
        if 2024 <= y <= 2027:
            return y
    return None


# ---------- TWK HTML ----------
def parse_twk(path: Path) -> list[dict]:
    html = path.read_text(errors="replace")
    rows = []
    tables = re.findall(r"<table\b[\s\S]*?</table>", html, re.I)
    for tbl in tables:
        trs = re.findall(r"<tr\b[\s\S]*?</tr>", tbl, re.I)
        if not trs:
            continue
        header = [sp.strip_tags(c).lower() for c in re.findall(r"<t[dh]\b[\s\S]*?</t[dh]>", trs[0], re.I)]
        if not any("b-bbee" in h or "bbbee" in h for h in header):
            continue
        # column indexes
        def col(*needles):
            for i, h in enumerate(header):
                if any(n in h for n in needles):
                    return i
            return None
        i_name = col("awarded to")
        i_level = col("b-bbee", "bbbee")
        i_date = col("date awarded", "date closed", "date")
        i_tender = col("ref")
        i_desc = col("quotation", "tender")
        i_amt = col("amount")
        if i_name is None or i_level is None:
            continue
        for tr in trs[1:]:
            cells = [sp.strip_tags(c) for c in re.findall(r"<t[dh]\b[\s\S]*?</t[dh]>", tr, re.I)]
            if len(cells) < max(i_name, i_level) + 1:
                continue
            name = cells[i_name]
            level = sp.parse_level(cells[i_level])
            if not level:
                continue
            tender = cells[i_tender] if i_tender is not None and i_tender < len(cells) else ""
            desc = cells[i_desc] if i_desc is not None and i_desc < len(cells) else ""
            raw_date = cells[i_date] if i_date is not None and i_date < len(cells) else ""
            amt = cells[i_amt] if i_amt is not None and i_amt < len(cells) else ""
            y = year_from_tender(tender)
            dt = modern_date(raw_date, y)
            parsed = sp.parse_date(raw_date)
            if parsed and parsed < "2024-01-01":
                continue
            if not dt and not y:
                continue
            if not dt:
                dt = str(y)
            rows.append(sp.rec(
                source="twk",
                institution="Theewaterskloof Municipality",
                sourceUrl="https://twk.gov.za/category/documents/supply-chain-management/quotations-and-tenders/quotations-and-tenders-awarded/",
                sourceTitle="Theewaterskloof Municipality quotations and tenders awarded",
                name=sp.clean_name(name),
                beeLevel=level,
                beeLevelRaw=cells[i_level],
                tenderNumber=sp.collapse(tender) or None,
                tenderDescription=sp.collapse(desc)[:240] or None,
                awardDate=dt,
                contractAmount=sp.collapse(amt) or None,
                outcome="awarded",
            ))
    return rows


# ---------- Molemole PDFs ----------
def parse_molemole(path: Path, fy: str) -> list[dict]:
    text = pdf_text(path)
    url = {
        "2025-26": "https://www.molemole.gov.za/docs/tenders/awarded/Bid%20Awarded%20Register%20202526%20(5).pdf",
        "2024-25": "https://www.molemole.gov.za/docs/tenders/awarded/Bid%20Awarded%20Register%20202425%20(5).pdf",
    }[fy]
    title = f"Molemole Local Municipality bids awarded register {fy}"
    blob = re.sub(r"\s+", " ", text)
    rows = []
    # NAME LEVEL N DATE
    pat = re.compile(
        r"([A-Z][A-Za-z0-9&.'’\-/ ]{3,70}?)\s+LEVEL\s*([1-8])\s+(\d{1,2}\s+[A-Z]+\s+20\d{2})",
        re.I,
    )
    for m in pat.finditer(blob):
        name = sp.clean_name(m.group(1))
        name = re.sub(r"^(Successful bidder|BBBEE.*Level|Date)\s+", "", name, flags=re.I)
        # leftover amount prefix
        name = re.sub(r"^R[\s\d,]+\.?\d*\s+", "", name)
        name = re.sub(r"^\d+\s+", "", name)
        dt = modern_date(m.group(3))
        if not dt:
            continue
        rows.append(sp.rec(
            source="molemole",
            institution="Molemole Local Municipality",
            sourceUrl=url,
            sourceTitle=title,
            name=name,
            beeLevel=m.group(2),
            beeLevelRaw="Level " + m.group(2),
            awardDate=dt,
            outcome="awarded",
        ))
    return rows


# ---------- Overstrand PDFs ----------
def overstrand_url(path: Path) -> tuple[str, str, str]:
    m = re.search(r"awards-([a-z]+)-(\d{4})", path.name)
    month, year = (m.group(1), m.group(2)) if m else ("", "")
    y = int(year) if year else 2025
    mo = month
    if y == 2024 or (y == 2025 and mo in "january february march april may june".split()):
        fy = "20242025"
    elif y == 2025 or (y == 2026 and mo in "january february march april may june".split()):
        fy = "20252026"
    else:
        fy = "20262027"
    url = f"https://www.overstrand.gov.za/document/supply-chain-management/bid-reports/bid-awards-{fy}/{path.stem}/?layout=file"
    title = f"Overstrand Municipality tender awards — {month} {year}"
    fallback = f"{month} {year}" if month else ""
    return url, title, fallback


def parse_overstrand(path: Path) -> list[dict]:
    text = pdf_text(path)
    if "Cancelled" in text and "NONE" in text and len(text) < 800:
        return []
    url, title, mid = overstrand_url(path)
    blob = re.sub(r"\s+", " ", text)
    blob = re.sub(r"Cancelled.{0,80}(N/A|no (acceptable )?bids?).{0,40}", " ", blob, flags=re.I)
    rows = []
    pat = re.compile(
        r"(SC\d{3,5}/\d{4})\s+"
        r"([A-Z][A-Za-z0-9&./'’\- ]{2,80}?(?:\(Pty\)\s*Ltd|Pty Ltd|PTY LTD|Limited|Ltd\.?|CC|Inc\.?))"
        r"\s+([1-8])\s+(\d+|N/A)",
        re.I,
    )
    for m in pat.finditer(blob):
        name = sp.salvage_name(sp.clean_name(m.group(2)))
        rows.append(sp.rec(
            source="overstrand",
            institution="Overstrand Municipality",
            sourceUrl=url,
            sourceTitle=title,
            name=name,
            beeLevel=m.group(3),
            beeLevelRaw=m.group(3),
            tenderNumber=m.group(1),
            awardDate=modern_date(mid),
            outcome="awarded",
        ))
    pat2 = re.compile(
        r"(\d{1,2}-[A-Z][a-z]{2}-\d{2})\s+"
        r"([A-Z][A-Za-z0-9&./'’\- ]{2,90}?(?:\(Pty\)\s*Ltd|Pty Ltd|PTY LTD|Limited|Ltd\.?|CC))"
        r"\s+([1-8])\s+",
        re.I,
    )
    if len(rows) < 2:
        for m in pat2.finditer(blob):
            name = sp.salvage_name(sp.clean_name(m.group(2)))
            if "cancelled" in name.lower():
                continue
            rows.append(sp.rec(
                source="overstrand",
                institution="Overstrand Municipality",
                sourceUrl=url,
                sourceTitle=title,
                name=name,
                beeLevel=m.group(3),
                beeLevelRaw=m.group(3),
                awardDate=modern_date(m.group(1)),
                outcome="awarded",
            ))
    return rows


# ---------- Stellenbosch PDF ----------
def parse_stellenbosch(path: Path, page_url: str, title: str) -> list[dict]:
    text = pdf_text(path)
    blob = re.sub(r"\s+", " ", text)
    rows = []
    # NAME L1 / L2 ... skip N/A
    pat = re.compile(
        r"([A-Z][A-Za-z0-9&.'’\-/ ]{2,70}?(?:\(Pty\)\s*Ltd|Pty Ltd|PTY LTD|Limited|Ltd\.?|CC|Inc\.?|NPC)?)\s+L([1-8])\b"
    )
    for m in pat.finditer(blob):
        name = sp.clean_name(m.group(1))
        name = re.sub(r"^(SUCCESSFUL BIDDER|B-BBEE STATUS.*CONTRIBUTOR|CIDB)\s+", "", name, flags=re.I)
        # duplicated tails like "FIRE AND RESCUE CC FIRE AND RESCUE CC"
        parts = name.split()
        if len(parts) >= 6 and parts[: len(parts)//2] == parts[len(parts)//2 :]:
            name = " ".join(parts[: len(parts)//2])
        dt = None
        # nearest date after name
        after = blob[m.end(): m.end() + 80]
        dm = re.search(r"(20\d{2}-\d{2}-\d{2})", after)
        if dm:
            dt = modern_date(dm.group(1))
        if not dt:
            ym = re.search(r"(20\d{2})", path.name)
            dt = ym.group(1) if ym else None
        if not dt or dt < "2024-01-01":
            continue
        tm = re.search(r"(BSM\s*\d+/\d+)", blob[max(0, m.start()-200): m.start()])
        rows.append(sp.rec(
            source="stellenbosch",
            institution="Stellenbosch Municipality",
            sourceUrl=page_url,
            sourceTitle=title,
            name=name,
            beeLevel=m.group(2),
            beeLevelRaw="L" + m.group(2),
            tenderNumber=sp.collapse(tm.group(1)) if tm else None,
            awardDate=dt,
            outcome="awarded",
        ))
    return rows


def load_existing() -> set[str]:
    names = sp.load_existing_names()
    for corpus in [
        OUT / "corpus-new.json",
        OUT / "corpus-modern-import.json",
        OUT / "corpus-modern-delta.json",
    ]:
        if corpus.exists():
            for item in json.loads(corpus.read_text()):
                names.add(sp.norm_key(item.get("canonicalName") or ""))
    return names


def main():
    all_rows: list[dict] = []
    twk = SRC / "twk" / "awarded.html"
    if twk.exists():
        all_rows.extend(parse_twk(twk))
    mm = SRC / "molemole"
    if (mm / "2025-26.pdf").exists():
        all_rows.extend(parse_molemole(mm / "2025-26.pdf", "2025-26"))
    if (mm / "2024-25.pdf").exists():
        all_rows.extend(parse_molemole(mm / "2024-25.pdf", "2024-25"))
    ov = SRC / "overstrand"
    if ov.exists():
        for p in sorted(ov.glob("*.pdf")):
            if p.stat().st_size < 2000:
                continue
            all_rows.extend(parse_overstrand(p))
    stel = SRC / "stellenbosch"
    for p in sorted(stel.glob("*.pdf")):
        if p.stat().st_size < 5000 or p.read_bytes()[:4] != b"%PDF":
            continue
        slug = p.stem
        page_url = f"https://stellenbosch.gov.za/download/{slug}/"
        all_rows.extend(parse_stellenbosch(p, page_url, f"Stellenbosch Municipality {slug.replace('-', ' ')}"))

    stats = Counter(r["source"] for r in all_rows)
    print("RAW", dict(stats), "total", len(all_rows))

    existing = load_existing()
    skipped = Counter()
    seen = set()
    corpus_by_name: dict[str, dict] = {}
    catalogue = []

    for r in all_rows:
        name = sp.salvage_name(sp.clean_name(r.get("name") or ""))
        name = salvage_trading(name)
        if not name:
            skipped["empty"] += 1
            continue
        if extra_reject(name) or looks_like_person(name):
            skipped["malformed"] += 1
            continue
        if sp.is_jv(name):
            skipped["jv"] += 1
            continue
        if sp.malformed(name):
            skipped["malformed"] += 1
            continue
        if not r.get("beeLevel"):
            skipped["no_level"] += 1
            continue
        dt = r.get("awardDate")
        if not dt or dt < "2024-01-01":
            skipped["pre_2024"] += 1
            continue
        key = (sp.norm_key(name), r["sourceUrl"], r.get("tenderNumber") or "", r.get("beeLevel") or "", dt)
        if key in seen:
            skipped["dup_row"] += 1
            continue
        seen.add(key)
        catalogue.append({**r, "name": name})
        nk = sp.norm_key(name)
        disclosure = {
            "sourceUrl": r["sourceUrl"],
            "governmentInstitution": r["institution"],
            "tenderNumber": r.get("tenderNumber") or None,
            "tenderDescription": r.get("tenderDescription") or None,
            "awardDate": dt,
            "beeLevel": r.get("beeLevel"),
            "contractAmount": r.get("contractAmount") or None,
            "sourceTitle": r.get("sourceTitle") or None,
            "outcome": r.get("outcome") or "awarded",
        }
        disclosure = {k: v for k, v in disclosure.items() if v is not None}
        item = corpus_by_name.get(nk)
        if not item:
            item = {
                "canonicalName": name,
                "legalName": name,
                "publishIfSafe": True,
                "procurement": [disclosure],
                "_existing": nk in existing,
            }
            corpus_by_name[nk] = item
        else:
            if "pty" in name.lower() and "pty" not in item["canonicalName"].lower():
                item["canonicalName"] = name
                item["legalName"] = name
            item["procurement"].append(disclosure)

    for item in corpus_by_name.values():
        rows = item["procurement"]
        def rank(d):
            return (0 if d.get("awardDate") else 1, d.get("awardDate") or "", d.get("tenderNumber") or "")
        rows.sort(key=rank, reverse=True)
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
    extra = [v for v in corpus_by_name.values() if v["_existing"]]
    for v in new_items + extra:
        v.pop("_existing", None)

    # Prefer new entities first, extras after
    import_items = new_items + extra
    (OUT / "corpus-muni-2024.json").write_text(json.dumps(import_items, indent=2))
    (OUT / "corpus-muni-new.json").write_text(json.dumps(new_items, indent=2))
    summary = {
        "raw": dict(stats),
        "raw_total": len(all_rows),
        "skipped": dict(skipped),
        "unique_entities": len(corpus_by_name),
        "new_entities": len(new_items),
        "existing_extra": len(extra),
        "years": Counter((i["procurement"][0].get("awardDate") or "")[:4] for i in new_items),
        "institutions": Counter(i["procurement"][0]["governmentInstitution"] for i in new_items),
        "sample_new": [i["canonicalName"] for i in new_items[:25]],
    }
    print(json.dumps({k: (dict(v) if isinstance(v, Counter) else v) for k, v in summary.items() if k != "sample_new"}, indent=2, default=str))
    print("SAMPLE NEW")
    for n in summary["sample_new"]:
        print(" ", n)
    print("wrote", OUT / "corpus-muni-2024.json", "items", len(import_items), "new", len(new_items))


if __name__ == "__main__":
    main()
