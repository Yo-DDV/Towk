import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { EDITIONS } from "./readme-fact-check/index.mjs";
import { BASELINE_SHA, updateEdition } from "./readme-fact-check/core.mjs";

const ROOT = process.cwd();
const LOCALE_FILTER = process.env.TOWK_README_LOCALE || "";
const STALE = [
  "The reporting window is the trailing 365 days.",
  "La fenêtre couvre les 365 derniers jours.",
  "Das Berichtsfenster umfasst die vergangenen 365 Tage.",
  "La ventana cubre los últimos 365 días.",
  "A janela abrange os últimos 365 dias."
];

if (LOCALE_FILTER && !EDITIONS[LOCALE_FILTER]) {
  throw new Error(`Unknown README locale: ${LOCALE_FILTER}`);
}

for (const [locale, edition] of Object.entries(EDITIONS)) {
  if (LOCALE_FILTER && locale !== LOCALE_FILTER) continue;
  test(`${edition.file} produces idempotent fact-checked copy`, async () => {
    const current = await readFile(path.join(ROOT, edition.file), "utf8");
    const updated = updateEdition(current, locale, edition);

    assert.ok(updated.includes(BASELINE_SHA), `${edition.file}: baseline SHA is missing`);
    assert.ok(updated.includes(edition.contributorAlt), `${edition.file}: contributor alt text is stale`);
    assert.ok(updated.includes("readme-metrics"), `${edition.file}: metrics branch link is missing`);
    for (const stale of STALE) {
      assert.ok(!updated.includes(stale), `${edition.file}: stale metrics methodology remains`);
    }
    if (updateEdition(updated, locale, edition) !== updated) {
      throw new Error(`${edition.file}: fact-check transformation is not idempotent`);
    }
  });
}
