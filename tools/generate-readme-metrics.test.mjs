import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LOCALES,
  assertBranch,
  assertRepository,
  buildMetrics,
  escapeXml,
  isBotIdentity,
  parseNextLink,
  renderActivitySvg,
  renderContributorsSvg,
  renderHeroSvg,
  writeAssets
} from "./generate-readme-metrics.mjs";

function commit({ date, login, type = "User" }) {
  return {
    author: { login, type },
    commit: {
      author: { name: login, date },
      committer: { name: login, date }
    }
  };
}

function pullRequest({ date, login, type = "User" }) {
  return { user: { login, type }, merged_at: date };
}

test("XML content is escaped before it enters generated SVG", () => {
  assert.equal(
    escapeXml(`<Towk & "friends">'`),
    "&lt;Towk &amp; &quot;friends&quot;&gt;&apos;"
  );
});

test("repository and branch inputs reject unsafe values", () => {
  assert.deepEqual(assertRepository("Yo-DDV/Towk"), {
    fullName: "Yo-DDV/Towk",
    owner: "Yo-DDV",
    name: "Towk"
  });
  assert.equal(assertBranch("release-0.8"), "release-0.8");
  assert.throws(() => assertRepository("Yo-DDV"));
  assert.throws(() => assertRepository("../Towk"));
  assert.throws(() => assertBranch("../main"));
  assert.throws(() => assertBranch("main.lock"));
});

test("GitHub pagination links select only rel=next", () => {
  const header = '<https://api.github.com/example?page=2>; rel="next", <https://api.github.com/example?page=8>; rel="last"';
  assert.equal(parseNextLink(header), "https://api.github.com/example?page=2");
  assert.equal(parseNextLink(null), null);
});

test("bot identities stay outside human contributor rankings", () => {
  assert.equal(isBotIdentity({ login: "dependabot[bot]", type: "Bot" }), true);
  assert.equal(isBotIdentity({ login: "github-actions[bot]", type: "User" }), true);
  assert.equal(isBotIdentity({ login: "Yo-DDV", type: "User" }), false);
});

test("metrics aggregate daily, weekly, monthly and author activity", () => {
  const now = new Date("2026-07-23T20:00:00Z");
  const commits = [
    commit({ date: "2026-07-23T12:00:00Z", login: "Yo-DDV" }),
    commit({ date: "2026-07-23T13:00:00Z", login: "Yo-DDV" }),
    commit({ date: "2026-07-20T09:00:00Z", login: "alice" }),
    commit({ date: "2026-06-02T10:00:00Z", login: "dependabot[bot]", type: "Bot" })
  ];
  const pullRequests = [
    pullRequest({ date: "2026-07-22T18:00:00Z", login: "Yo-DDV" }),
    pullRequest({ date: "2026-06-11T18:00:00Z", login: "dependabot[bot]", type: "Bot" })
  ];

  const metrics = buildMetrics(commits, pullRequests, now);
  assert.equal(metrics.commits, 4);
  assert.equal(metrics.mergedPullRequests, 2);
  assert.equal(metrics.activeDays, 3);
  assert.equal(metrics.humanCommitAuthors, 2);
  assert.equal(metrics.automationCommits, 1);
  assert.equal(metrics.automationPullRequests, 1);
  assert.deepEqual(metrics.commitAuthors, [
    { label: "Yo-DDV", count: 2 },
    { label: "alice", count: 1 }
  ]);
  assert.deepEqual(metrics.pullRequestAuthors, [{ label: "Yo-DDV", count: 1 }]);
  assert.equal(metrics.daily.at(-1).value, 2);
  assert.equal(metrics.monthlyCommitsByLocale.en.at(-1).label, "Jul");
  assert.equal(metrics.monthlyCommitsByLocale.en.at(-1).value, 3);
  assert.equal(metrics.monthlyPullRequestsByLocale.fr.at(-1).value, 1);
});

test("every supported locale renders accessible desktop and mobile SVG", () => {
  const metrics = buildMetrics([], [], new Date("2026-07-23T20:00:00Z"));
  for (const locale of Object.keys(LOCALES)) {
    for (const svg of [
      renderHeroSvg(locale, false),
      renderHeroSvg(locale, true),
      renderActivitySvg(metrics, locale, false),
      renderActivitySvg(metrics, locale, true),
      renderContributorsSvg(metrics, locale, false),
      renderContributorsSvg(metrics, locale, true)
    ]) {
      assert.match(svg, /^<svg /);
      assert.match(svg, /role="img"/);
      assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
      assert.doesNotMatch(svg, /<script/i);
      assert.doesNotMatch(svg, /<foreignObject/i);
    }
  }
});

test("asset writer produces the complete localized public bundle", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "towk-readme-metrics-"));
  const metrics = buildMetrics(
    [commit({ date: "2026-07-23T12:00:00Z", login: "Yo-DDV" })],
    [pullRequest({ date: "2026-07-22T18:00:00Z", login: "Yo-DDV" })],
    new Date("2026-07-23T20:00:00Z")
  );
  await writeAssets({
    outputDir,
    metrics,
    repository: "Yo-DDV/Towk",
    branch: "main",
    sourceCommit: "0123456789abcdef"
  });

  for (const locale of Object.keys(LOCALES)) {
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
  assert.equal(publicMetrics.repository, "Yo-DDV/Towk");
  assert.equal(publicMetrics.sourceCommit, "0123456789abcdef");
  assert.equal(publicMetrics.commits, 1);
  for (const forbidden of ["rawCommits", "emails", "messages"]) {
    assert.equal(forbidden in publicMetrics, false);
  }
});
