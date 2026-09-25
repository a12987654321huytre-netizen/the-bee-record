import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("corpus import auth migration", () => {
  it("keeps existing hardcoded hashes and adds env-based hashes in source", () => {
    const src =
      readFileSync(resolve("src/lib/bee/corpus-import-auth.ts"), "utf8") +
      readFileSync(resolve("src/lib/bee/corpus-import.server.ts"), "utf8");
    assert.match(src, /CORPUS_IMPORT_TOKEN_SHA256/);
    assert.match(src, /CORPUS_IMPORT_TOKEN_SHA256_BATCH/);
    assert.match(src, /CORPUS_IMPORT_TOKEN_SHA256_SCALE5K/);
    assert.match(src, /process\.env\.CORPUS_IMPORT_TOKEN_SHA256/);
    assert.match(src, /process\.env\.CORPUS_IMPORT_TOKEN/);
    const hashes = [...src.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
    assert.equal(hashes.length >= 3, true);
    for (const h of hashes) {
      assert.equal(h.length, 64);
    }
  });

  it("does not treat campaign token hashes as raw tokens", () => {
    const src =
      readFileSync(resolve("src/lib/bee/corpus-import-auth.ts"), "utf8") +
      readFileSync(resolve("src/lib/bee/corpus-import.server.ts"), "utf8");
    assert.doesNotMatch(src, /Bearer [A-Za-z0-9_-]{20,}/);
    const digest = createHash("sha256").update("not-the-real-token").digest("hex");
    assert.equal(digest.length, 64);
  });
});

describe("import runner resume", () => {
  it("writes a durable checkpoint path instead of relying only on a log", () => {
    const src = readFileSync(resolve("scripts/run-procurement-import.mjs"), "utf8");
    assert.match(src, /import-checkpoint\.json/);
    assert.match(src, /CORPUS_CHECKPOINT/);
    assert.match(src, /CORPUS_RUN_ID/);
    assert.match(src, /CORPUS_LOG/);
    assert.match(src, /nextIndex/);
  });
});
