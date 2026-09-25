import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

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

  it("resumes from the saved offset without reposting completed batches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bee-import-checkpoint-"));
    const script = join(dir, "run-procurement-import.mjs");
    mkdirSync(join(dir, "data", "procurement"), { recursive: true });
    mkdirSync(join(dir, "data", "procurement-pipeline"), { recursive: true });
    writeFileSync(script, readFileSync(resolve("scripts/run-procurement-import.mjs")));
    writeFileSync(join(dir, ".corpus-import-token"), "test-token\n");
    writeFileSync(join(dir, "data", "procurement", "corpus-pipeline.json"), JSON.stringify([
      { canonicalName: "Checkpoint Test Supplier", procurement: [{ sourceUrl: "https://example.gov.za/award.pdf", governmentInstitution: "Example Municipality", beeLevel: "1", awardDate: "2025" }] },
    ]));
    writeFileSync(join(dir, "data", "procurement-pipeline", "progress.json"), JSON.stringify({ documents: {
      sample: { source_url: "https://example.gov.za/award.pdf", content_hash: "abc123", import_status: null },
    } }));
    let imports = 0;
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (req.url !== "/api/corpus-import") {
          res.statusCode = 404;
          return res.end("not found");
        }
        if (!body.action) imports += 1;
        res.end(JSON.stringify(body.action === "stats" ? { ok: true } : { ok: true, results: [{ created: false, published: false, skipped: true }] }));
      });
    });
    await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const env = { ...process.env, CORPUS_IMPORT_URL: url, CORPUS_BATCH: "1", CORPUS_RETRIES: "0", CORPUS_RUN_ID: "checkpoint-test" };
      await execFileAsync(process.execPath, [script, "data/procurement/corpus-pipeline.json"], { cwd: dir, env });
      const checkpoint = JSON.parse(readFileSync(join(dir, "data", "procurement-pipeline", "import-checkpoint.json"), "utf8"));
      assert.equal(checkpoint.nextIndex, 1);
      const progress = JSON.parse(readFileSync(join(dir, "data", "procurement-pipeline", "progress.json"), "utf8"));
      assert.equal(progress.documents.sample.import_status, "IMPORTED");
      assert.equal(progress.documents.sample.imported_content_hash, "abc123");
      await execFileAsync(process.execPath, [script, "data/procurement/corpus-pipeline.json"], { cwd: dir, env });
      assert.equal(imports, 1);
    } finally {
      await new Promise((resolveServer) => server.close(resolveServer));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
