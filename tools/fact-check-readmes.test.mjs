import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { EDITIONS } from "./readme-fact-check/index.mjs";
import { BASELINE_SHA, updateEdition } from "./readme-fact-check/core.mjs";

const ROOT = process.cwd();
const STALE = [
  "The reporting window is the trailing 365 days.",
  "La fenêtre couvre les 365 derniers jours.",
  "Das Berichtsfenster umfasst die vergangenen 365 Tage.",
  "La ventana cubre los últimos 365 días.",
  "A janela abrange os últimos 365 dias."
];

for (const [locale, edition] of Object.entries(EDITIONS)) {
  test(`${edition.file} produces idempotent fact-checked copy`, async () => {
    const current = await readFile(path.join(ROOT, edition.file), "utf8");
    const updated = updateEdition(current, locale, edition);

    assert.ok(updated.includes(BASELINE_SHA));
    assert.ok(updated.includes(edition.contributorAlt));
    assert.ok(updated.includes("readme-metrics"));
    for (const stale of STALE) assert.ok(!updated.includes(stale));
    assert.equal(updateEdition(updated, locale, edition), updated);
  });
}
