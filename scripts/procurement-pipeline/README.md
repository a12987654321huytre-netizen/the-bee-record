# Procurement pipeline

This pipeline rebuilds its work queue from `data/procurement-pipeline/sources.json`. The document ledger lives in `progress.json`; source documents are downloaded to `/tmp/bee-sources/` by default. Set `BEE_SOURCE_DIR` to move those temporary binaries.

Install the PDF text extraction dependency once in the Python environment used by the operator:

```sh
python3 -m pip install -r scripts/procurement-pipeline/requirements.txt
```

Resume acquisition, adapter parsing, validation, and corpus generation with:

```sh
python3 scripts/procurement-pipeline/run.py resume --json
```

The command writes `data/procurement/corpus-pipeline.json` in the existing corpus-import format and rejected rows with explicit reasons to `data/procurement-pipeline/rejected.json`. It never calls the importer or writes to a database. After reviewing the generated corpus, the existing importer can be run separately with an operator-provided token.

`scripts/run-procurement-import.mjs` records its offset in `data/procurement-pipeline/import-checkpoint.json`. A successful batch also records the corresponding source documents as imported in `progress.json`; a later download compares source content SHA-256 before deciding whether unchanged evidence can be skipped.
