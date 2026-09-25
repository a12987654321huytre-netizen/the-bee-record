"""Durable source registry + document ledger. Survives sandbox wipes; binaries may not."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "procurement-pipeline"
SOURCES = DATA / "sources.json"
PROGRESS = DATA / "progress.json"
DOWNLOAD_ROOT = Path(os.environ.get("BEE_SOURCE_DIR", "/tmp/bee-sources"))

STATUSES = (
    "DISCOVERED",
    "DOWNLOADED",
    "BLOCKED",
    "PARSED",
    "VALIDATION_FAILED",
    "READY",
    "IMPORTING",
    "IMPORTED",
    "PARTIAL",
    "FAILED",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_sources() -> dict[str, Any]:
    data = load_json(SOURCES, {"source_families": []})
    return data


def load_progress() -> dict[str, Any]:
    data = load_json(
        PROGRESS,
        {"updated_at": None, "documents": {}, "runs": [], "import_checkpoint": {}},
    )
    data.setdefault("documents", {})
    data.setdefault("runs", [])
    data.setdefault("import_checkpoint", {})
    return data


def save_progress(progress: dict[str, Any]) -> None:
    progress["updated_at"] = utc_now()
    atomic_write(PROGRESS, progress)


def document_key(source_family_id: str, source_url: str) -> str:
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
    slug = source_url.rstrip("/").split("/")[-1][:60]
    slug = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in slug)
    return f"{source_family_id}:{slug}:{digest}"


def ensure_document(progress: dict[str, Any], family: dict[str, Any], url: str, title: str | None = None) -> dict[str, Any]:
    key = document_key(family["source_family_id"], url)
    docs = progress["documents"]
    if key not in docs:
        docs[key] = {
            "document_key": key,
            "source_family": family["source_family_id"],
            "institution": family["institution"],
            "source_url": url,
            "document_title": title,
            "evidence_mode": family["evidence_mode"],
            "download_status": "DISCOVERED",
            "parser_status": None,
            "validation_status": None,
            "import_status": None,
            "status": "DISCOVERED",
            "candidate_count": 0,
            "valid_candidate_count": 0,
            "rejected_count": 0,
            "last_error": None,
            "content_hash": None,
            "first_seen": utc_now(),
            "last_attempted": None,
            "local_path": None,
        }
    return docs[key]


def content_hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def local_path_for(doc: dict[str, Any]) -> Path:
    if doc.get("local_path"):
        return Path(doc["local_path"])
    fam = doc["source_family"]
    name = doc["document_key"].split(":", 1)[-1]
    return DOWNLOAD_ROOT / fam / name
