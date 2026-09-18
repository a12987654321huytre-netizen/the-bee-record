import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./with-app-env.mjs";

const destDir = join(projectRoot(), ".vercel/output/functions/__server.func/_libs");
const srcDir = join(projectRoot(), "node_modules/@electric-sql/pglite/dist");
if (!existsSync(srcDir) || !existsSync(join(projectRoot(), ".vercel/output"))) {
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
  const from = join(srcDir, name);
  if (existsSync(from)) copyFileSync(from, join(destDir, name));
}
