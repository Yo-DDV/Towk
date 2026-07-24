import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { EDITIONS } from "./readme-fact-check/index.mjs";
import { updateEdition } from "./readme-fact-check/core.mjs";

export async function main(root = process.cwd()) {
  const changed = [];
  for (const [locale, edition] of Object.entries(EDITIONS)) {
    const file = path.join(root, edition.file);
    const current = await readFile(file, "utf8");
    const updated = updateEdition(current, locale, edition);
    if (updated !== current) {
      await writeFile(file, updated, "utf8");
      changed.push(edition.file);
    }
  }
  process.stdout.write(changed.length > 0
    ? `Updated fact-checked README copy: ${changed.join(", ")}\n`
    : "README fact-check copy is already current\n");
  return changed;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
