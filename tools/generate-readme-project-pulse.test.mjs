import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildMetrics } from "./generate-readme-metrics.mjs";
import {
  PULSE_LOCALE_OVERRIDES,
  assertBranch,
  assertCommitSha,
  assertRepository,
  filterPullRequestsAfterBaseline,
  parseNextLink,
  writeProjectPulseAssets
} from "./generate-readme-project-pulse.mjs";

function commit({ date, login, type = "User" }) {
  return {
    author: { login, type },
    commit: {
      author: { name: login, date },
      committer: { name: login, date }
    }
  };
}

function pullRequest({ date, login = "Yo-DDV", type = "User" }) {
  return { user: { login, type }, merged_at: date };
}

test("repository, branch and baseline inputs reject unsafe values", () => {
  assert.deepEqual(assertRepository("Yo-DDV/Towk"), {
    fullName: "Yo-DDV/Towk",
    owner: "Yo-DDV",
    name: "Towk"
  });
  assert.equal(assertBranch("main"), "main");
  assert.equal(
    assertCommitSha("205E91FE1AE5E5C23420974F7E04CF82456EEAB3"),
    "205e91fe1ae5e5c23420974f7e04cf82456eeab3"
  );
  assert.throws(() => assertRepository("../Towk"));
  assert.throws(() => assertBranch("../main"));
  assert.throws(() => assertCommitSha("205e91fe"));
});

test("GitHub pagination links select only rel=next", () => {
  const header = '<https://api.github.com/example?page=2>; rel="next", <https://api.github.com/example?page=8>; rel="last"';
  assert.equal(parseNextLink(header), "https://api.github.com/example?page=2");
  assert.equal(parseNextLink(null), null);
});

test("merged pull requests are bounded by the independent baseline and snapshot", () => {
  const result = filterPullRequestsAfterBaseline(
    [
      pullRequest({ date: "2026-07-12T10:20:05.000Z" }),
      pullRequest({ date: "2026-07-12T10:20:06.000Z" }),
      pullRequest({ date: "2026-07-23T20:00:00.000Z" }),
      pullRequest({ date: "2026-07-23T20:00:01.000Z" }),
      { user: { login: "closed-only", type: "User" }, merged_at: null }
    ],
    "2026-07-12T10:20:05.000Z",
    "2026-07-23T20:00:00.000Z"
  );
  assert.deepEqual(result.map((item) => item.user.login), ["Yo-DDV", "Yo-DDV"]);
});

test("locale overrides stay concise enough for mobile chart headers", () => {
  assert.deepEqual(Object.keys(PULSE_LOCALE_OVERRIDES), ["en", "fr", "de", "es", "pt"]);
  for (const [locale, copy] of Object.entries(PULSE_LOCALE_OVERRIDES)) {
    assert.ok(copy.pulseSubtitle.length <= 55, `${locale} pulse subtitle is too long`);
    assert.ok(copy.contributorsSubtitle.length <= 55, `${locale} contributor subtitle is too long`);
    assert.ok(copy.botsNote.length <= 42, `${locale} bot note is too long`);
  }
});

test("writer produces the complete localized independent-project bundle", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "towk-independent-pulse-"));
  const metrics = buildMetrics(
    [
      commit({ date: "2026-07-23T12:00:00Z", login: "Yo-DDV" }),
      commit({ date: "2026-07-23T13:00:00Z", login: "dependabot[bot]", type: "Bot" })
    ],
    [pullRequest({ date: "2026-07-22T18:00:00Z" })],
    new Date("2026-07-23T20:00:00Z")
  );
  await writeProjectPulseAssets({
    outputDir,
    metrics,
    repository: "Yo-DDV/Towk",
    branch: "main",
    sourceCommit: "0123456789abcdef",
    baselineSha: "205e91fe1ae5e5c23420974f7e04cf82456eeab3",
    baselineAt: "2026-07-12T10:20:05.000Z"
  });

  for (const locale of Object.keys(PULSE_LOCALE_OVERRIDES)) {
    for (const name of [
      "hero.svg",
      "hero-mobile.svg",
      "activity.svg",
      "activity-mobile.svg",
      "contributors.svg",
      "contributors-mobile.svg"
    ]) {
      const file = path.join(outputDir, locale, name);
      assert.equal((await stat(file)).isFile(), true);
      assert.match(await readFile(file, "utf8"), /^<svg /);
    }
  }

  const publicMetrics = JSON.parse(await readFile(path.join(outputDir, "metrics.json"), "utf8"));
  assert.equal(publicMetrics.version, 2);
  assert.equal(publicMetrics.window, "since-independent-baseline");
  assert.equal(publicMetrics.baselineCommit, "205e91fe1ae5e5c23420974f7e04cf82456eeab3");
  assert.equal(publicMetrics.commits, 2);
  assert.deepEqual(publicMetrics.commitAuthors, [{ label: "Yo-DDV", count: 1 }]);
  for (const forbidden of ["rawCommits", "emails", "messages"]) {
    assert.equal(forbidden in publicMetrics, false);
  }
});
