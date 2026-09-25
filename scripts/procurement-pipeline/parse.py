"""Registered adapter dispatch and normalized-corpus construction."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from ledger import content_hash_bytes, load_progress, save_progress, utc_now
from validate import validate_rows


def dispatch(path: Path, family: dict[str, Any], document: dict[str, Any]) -> list[dict[str, Any]]:
    adapter_name = family.get("adapter")
    if not adapter_name:
        raise ValueError("source family has no adapter")
    adapter = importlib.import_module(f"source_adapters.{adapter_name}")
    meta = {**family, **document, "source_url": document["source_url"]}
    return adapter.parse(path, meta)


def normalize_corpus(all_valid: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group supplier records and deduplicate evidence before export."""
    grouped: dict[str, dict[str, Any]] = {}
    seen_evidence: set[tuple[str, str, str, str, str]] = set()
    for item in all_valid:
        disclosure = item["procurement"]
        key = " ".join(item["canonicalName"].lower().replace("&", " and ").split())
        evidence_key = (key, disclosure["sourceUrl"], disclosure.get("tenderNumber") or "", disclosure["beeLevel"], disclosure["awardDate"])
        if evidence_key in seen_evidence:
            continue
        seen_evidence.add(evidence_key)
        grouped.setdefault(key, {"canonicalName": item["canonicalName"], "legalName": item["legalName"], "publishIfSafe": True, "procurement": []})
        group = grouped[key]
        if "(pty)" in item["canonicalName"].lower() and "(pty)" not in group["canonicalName"].lower():
            group["canonicalName"] = group["legalName"] = item["canonicalName"]
        group["procurement"].append(disclosure)
    for item in grouped.values():
        item["procurement"] = item["procurement"][:8]
    return list(grouped.values())


def parse_pending() -> dict[str, Any]:
    from ledger import load_sources

    sources = load_sources()
    progress = load_progress()
    family_by_id = {f["source_family_id"]: f for f in sources.get("source_families", [])}
    all_valid: list[dict[str, Any]] = []
    all_rejected: list[dict[str, Any]] = []
    parsed = skipped = failed = 0
    for doc in progress["documents"].values():
        if doc.get("download_status") != "DOWNLOADED":
            continue
        path = Path(doc.get("local_path") or "")
        family = family_by_id.get(doc.get("source_family"))
        if not family or not path.is_file():
            doc.update(status="FAILED", parser_status="failed", last_error="missing_source_or_binary")
            failed += 1
            continue
        digest = content_hash_bytes(path.read_bytes())
        if doc.get("import_status") == "IMPORTED" and doc.get("imported_content_hash", doc.get("content_hash")) == digest:
            doc.update(status="IMPORTED", parser_status="unchanged", last_attempted=utc_now())
            skipped += 1
            continue
        try:
            meta = {**family, **doc, "source_url": doc["source_url"]}
            rows = dispatch(path, family, doc)
            valid, rejected = validate_rows(rows, meta)
            for item in valid:
                item["procurement"]["sourceUrl"] = doc["source_url"]
            all_valid.extend(valid)
            all_rejected.extend({"document_key": doc["document_key"], **r} for r in rejected)
            doc.update(
                status="READY" if not rejected else ("PARTIAL" if valid else "VALIDATION_FAILED"),
                parser_status="parsed",
                validation_status="passed" if not rejected else "partial",
                candidate_count=len(rows),
                valid_candidate_count=len(valid),
                rejected_count=len(rejected),
                content_hash=digest,
                last_error=None,
                last_attempted=utc_now(),
            )
            parsed += 1
        except Exception as exc:
            doc.update(status="FAILED", parser_status="failed", last_error=f"{type(exc).__name__}: {exc}", last_attempted=utc_now())
            failed += 1
    grouped = normalize_corpus(all_valid)
    save_progress(progress)
    return {"parsed": parsed, "skipped_unchanged": skipped, "failed": failed, "items": grouped, "rejected": all_rejected}
