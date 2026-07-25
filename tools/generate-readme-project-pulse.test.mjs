import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRepositoryActivity } from "./generate-readme-repository-activity.mjs";
import { assertBranch, assertCommitSha, assertRepository, filterIssuesForWindow, filterPullRequestsForWindow, parseNextLink, parseNumstatLog, writeProjectPulseAssets } from "./generate-readme-project-pulse.mjs";

const commit = ({ sha, date, login = "Yo-DDV", type = "User" }) => ({ sha, author: { login, type }, commit: { author: { name: login, date }, committer: { name: login, date } } });
const pr = ({ number = 1, createdAt, mergedAt, login = "Yo-DDV", reviews = [] }) => ({ number, created_at: createdAt, merged_at: mergedAt, updated_at: mergedAt, user: { login, type: "User" }, reviews });

test("repository, branch and baseline inputs reject unsafe values", () => {
  assert.deepEqual(assertRepository("Yo-DDV/Towk"), { fullName: "Yo-DDV/Towk", owner: "Yo-DDV", name: "Towk" });
  assert.equal(assertBranch("docs/readme-repository-activity"), "docs/readme-repository-activity");
  assert.equal(assertCommitSha("205E91FE1AE5E5C23420974F7E04CF82456EEAB3"), "205e91fe1ae5e5c23420974f7e04cf82456eeab3");
  assert.throws(() => assertRepository("../Towk")); assert.throws(() => assertBranch("../main")); assert.throws(() => assertCommitSha("205e91fe"));
});

test("GitHub pagination links select only rel=next", () => {
  const header = '<https://api.github.com/example?page=2>; rel="next", <https://api.github.com/example?page=8>; rel="last"';
  assert.equal(parseNextLink(header), "https://api.github.com/example?page=2"); assert.equal(parseNextLink(null), null);
});

test("pull request and issue filters use merged or closed time and exclude pull requests from issues", () => {
  const from = "2026-07-01T00:00:00Z", to = "2026-07-25T12:00:00Z";
  assert.deepEqual(filterPullRequestsForWindow([
    pr({ number: 1, createdAt: "2026-06-01T00:00:00Z", mergedAt: "2026-07-01T00:00:00Z" }),
    pr({ number: 2, createdAt: "2026-07-01T00:00:00Z", mergedAt: "2026-07-25T12:00:00Z" }),
    pr({ number: 3, createdAt: "2026-07-01T00:00:00Z", mergedAt: "2026-07-25T12:00:01Z" }), { number: 4, merged_at: null }
  ], from, to).map((item) => item.number), [1, 2]);
  assert.deepEqual(filterIssuesForWindow([
    { number: 10, closed_at: "2026-07-02T00:00:00Z" },
    { number: 11, closed_at: "2026-07-02T00:00:00Z", pull_request: { url: "x" } },
    { number: 12, closed_at: "2026-06-30T23:59:59Z" }
  ], from, to).map((item) => item.number), [10]);
});

test("git numstat parser counts binary files without inventing line totals", () => {
  const first = "0123456789abcdef0123456789abcdef01234567", second = "89abcdef0123456789abcdef0123456789abcdef";
  const stats = parseNumstatLog(`commit:${first}\n12\t3\tsrc/a.ts\n-\t-\tlogo.webp\n4\t0\tREADME.md\ncommit:not-a-sha\n9\t9\tignored\ncommit:${second}\n0\t7\tsrc/b.ts\n`);
  assert.deepEqual(stats.get(first), { additions: 16, deletions: 3, filesChanged: 3 });
  assert.deepEqual(stats.get(second), { additions: 0, deletions: 7, filesChanged: 1 });
  assert.equal(stats.size, 2);
});

test("writer produces one localized activity visual, hero assets and a privacy-bounded snapshot", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "towk-activity-"));
  const metrics = buildRepositoryActivity({
    commits: [commit({ sha: "a", date: "2026-07-25T10:00:00Z" }), commit({ sha: "b", date: "2026-07-25T11:00:00Z", login: "dependabot[bot]", type: "Bot" })],
    pullRequests: [pr({ createdAt: "2026-07-23T10:00:00Z", mergedAt: "2026-07-25T10:00:00Z", reviews: [{ submitted_at: "2026-07-23T14:00:00Z", user: { login: "reviewer", type: "User" }, state: "APPROVED" }] })],
    issues: [{ number: 2, closed_at: "2026-07-24T10:00:00Z" }],
    commitStats: { a: { additions: 12, deletions: 4, filesChanged: 2 }, b: { additions: 1, deletions: 1, filesChanged: 1 } }, now: new Date("2026-07-25T12:00:00Z")
  });
  await writeProjectPulseAssets({ outputDir, metrics, repository: "Yo-DDV/Towk", branch: "main", sourceCommit: "0123456789abcdef0123456789abcdef01234567", baselineSha: "205e91fe1ae5e5c23420974f7e04cf82456eeab3", baselineAt: "2026-07-12T10:20:05.000Z", effectiveStart: "2026-07-12T10:20:05.000Z" });
  for (const locale of ["en", "fr", "de", "es", "pt"]) {
    for (const name of ["hero.svg", "hero-mobile.svg", "activity.svg", "activity-mobile.svg"]) {
      const file = path.join(outputDir, locale, name); assert.equal((await stat(file)).isFile(), true); assert.match(await readFile(file, "utf8"), /^<svg /);
    }
    await assert.rejects(stat(path.join(outputDir, locale, "contributors.svg")));
  }
  const snapshot = JSON.parse(await readFile(path.join(outputDir, "metrics.json"), "utf8"));
  assert.equal(snapshot.version, 3); assert.equal(snapshot.window.kind, "rolling-30-utc-days"); assert.deepEqual(snapshot.headline, metrics.headline);
  for (const forbidden of ["rawCommits", "emails", "messages", "commitAuthors", "pullRequestAuthors", "reviews"]) assert.equal(forbidden in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes("dependabot[bot]"), false);
});
