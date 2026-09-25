#!/usr/bin/env python3
"""Resume procurement source acquisition and normalization; never imports to a database."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from download import download_pending
from ledger import DATA, atomic_write, load_progress
from parse import parse_pending


def resume() -> dict:
    download = download_pending()
    parsed = parse_pending()
    corpus_path = DATA.parent / "procurement" / "corpus-pipeline.json"
    rejected_path = DATA / "rejected.json"
    atomic_write(corpus_path, parsed["items"])
    atomic_write(rejected_path, parsed["rejected"])
    progress = load_progress()
    reasons = Counter(reason for row in parsed["rejected"] for reason in row.get("reasons", []))
    return {
        "ok": parsed["failed"] == 0,
        "download": download,
        "parsed_documents": parsed["parsed"],
        "unchanged_documents_skipped": parsed["skipped_unchanged"],
        "failed_documents": parsed["failed"],
        "registered_documents": len(progress["documents"]),
        "normalized_supplier_count": len(parsed["items"]),
        "rejected_candidate_count": len(parsed["rejected"]),
        "rejected_reasons": dict(reasons),
        "corpus_file": str(corpus_path.relative_to(DATA.parents[1])),
        "rejections_file": str(rejected_path.relative_to(DATA.parents[1])),
        "database_written": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["resume"])
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()
    result = resume()
    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
