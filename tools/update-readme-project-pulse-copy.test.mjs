import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EDITIONS, main, updateEdition } from "./update-readme-project-pulse-copy.mjs";

function legacyReadme(locale) {
  return `<div>
<a href=".github/workflows/refresh-readme-metrics.yml"><img src="https://img.shields.io/badge/activity-refreshed%20twice%20daily-7867f2?style=flat-square" alt="old activity badge" /></a>
<a href="#development-pulse">Development pulse</a>
</div>

<a id="development-pulse"></a>
## Development pulse

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/activity-mobile.svg" />
  <img src="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/activity.svg" width="100%" alt="old activity" />
</picture>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/contributors-mobile.svg" />
  <img src="https://raw.githubusercontent.com/Yo-DDV/Towk/readme-metrics/${locale}/contributors.svg" width="100%" alt="old contributors" />
</picture>

<details>
  <summary><strong>Old methodology</strong></summary>
  Old cumulative methodology.
</details>

<a id="capabilities"></a>
## Capabilities
`;
}

test("all localized editions replace the old pulse with one factual repository activity section", () => {
  for (const [locale, edition] of Object.entries(EDITIONS)) {
    const updated = updateEdition(legacyReadme(locale), locale, edition);
    assert.match(updated, /activity-GitHub%20Actions%20%2F%206h/);
    assert.match(updated, new RegExp(`<a href="#repository-activity">${edition.navLabel}</a>`));
    assert.match(updated, new RegExp(`## ${edition.title}`));
    assert.match(updated, new RegExp(`${locale}/activity-mobile\\.svg`));
    assert.match(updated, new RegExp(`${locale}/activity\\.svg`));
    assert.doesNotMatch(updated, /contributors(?:-mobile)?\.svg/);
    assert.doesNotMatch(updated, /Development pulse/);
    assert.match(updated, /30/);
    assert.match(updated, /GITHUB_TOKEN/);
    assert.match(updated, /--numstat/);
    assert.match(updated, /created_at/);
    assert.match(updated, /merged_at/);
    assert.equal(updateEdition(updated, locale, edition), updated, `${locale} update is not idempotent`);
  }
});

test("missing anchors and duplicate sections are rejected", () => {
  assert.throws(() => updateEdition("not a README", "en"), /activity badge was not found/);
  const duplicate = `${legacyReadme("en")}\n${legacyReadme("en")}`;
  assert.throws(() => updateEdition(duplicate, "en"), /expected one activity section/);
});

test("main writes every README once and --check validates the synchronized result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "towk-readmes-"));
  for (const [locale, edition] of Object.entries(EDITIONS)) await writeFile(path.join(root, edition.file), legacyReadme(locale), "utf8");
  const changed = await main({ root, check: false });
  assert.deepEqual(changed.sort(), Object.values(EDITIONS).map((edition) => edition.file).sort());
  assert.deepEqual(await main({ root, check: true }), []);
  for (const edition of Object.values(EDITIONS)) {
    const content = await readFile(path.join(root, edition.file), "utf8");
    assert.match(content, /repository-activity/);
  }
});
