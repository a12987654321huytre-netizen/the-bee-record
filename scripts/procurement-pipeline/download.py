"""Download official source documents. State lives in the ledger, files may live in /tmp."""
from __future__ import annotations

import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ledger import (  # noqa: E402
    DOWNLOAD_ROOT,
    content_hash_bytes,
    ensure_document,
    load_progress,
    load_sources,
    local_path_for,
    save_progress,
    utc_now,
)

UA = "TheBEERecord/1.0 research bot (public procurement evidence index; +https://the-bee-record.vercel.app)"


def fetch(url: str, dest: Path, timeout: int = 45) -> tuple[bool, str, str | None]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 800:
        digest = content_hash_bytes(dest.read_bytes())
        return True, "exists", digest
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        dest.write_bytes(data)
        return True, f"ok {len(data)}", content_hash_bytes(data)
    except HTTPError as e:
        return False, f"http {e.code}", None
    except Exception as e:
        return False, type(e).__name__, None


def download_pending(limit: int | None = None) -> dict:
    sources = load_sources()
    progress = load_progress()
    ok = fail = skipped = 0
    n = 0
    for family in sources.get("source_families", []):
        if not family.get("active", True):
            continue
        for url in family.get("seed_urls", []):
            doc = ensure_document(progress, family, url)
            if doc.get("status") == "IMPORTED" and doc.get("content_hash"):
                skipped += 1
                continue
            dest = local_path_for(doc)
            prev_hash = doc.get("content_hash")
            success, msg, digest = fetch(url, dest)
            doc["last_attempted"] = utc_now()
            doc["local_path"] = str(dest)
            if success:
                ok += 1
                doc["download_status"] = "DOWNLOADED"
                if digest and prev_hash and digest != prev_hash:
                    doc["status"] = "DISCOVERED"
                    doc["parser_status"] = "changed"
                    doc["last_error"] = "content_hash_changed"
                elif doc.get("status") in (None, "DISCOVERED", "BLOCKED", "FAILED"):
                    doc["status"] = "DOWNLOADED"
                doc["content_hash"] = digest
            else:
                fail += 1
                doc["download_status"] = "BLOCKED"
                doc["status"] = "BLOCKED"
                doc["last_error"] = msg
            n += 1
            if limit and n >= limit:
                break
            time.sleep(0.05)
        if limit and n >= limit:
            break
    save_progress(progress)
    return {"ok": ok, "fail": fail, "skipped": skipped, "download_root": str(DOWNLOAD_ROOT)}


if __name__ == "__main__":
    print(download_pending())
