import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_LOCALES, buildRepositoryActivity, isBotIdentity, median, renderRepositoryActivitySvg } from "./generate-readme-repository-activity.mjs";

const commit = ({ sha, date, login, type = "User", name = login }) => ({ sha, author: login ? { login, type } : null, commit: { author: { name, date }, committer: { name, date } } });
const pr = ({ number, createdAt, mergedAt, login = "Yo-DDV", type = "User", reviews = [] }) => ({ number, created_at: createdAt, merged_at: mergedAt, user: { login, type }, reviews });
const review = ({ submittedAt, login, type = "User" }) => ({ submitted_at: submittedAt, user: { login, type }, state: "APPROVED" });

test("median and bot classification are deterministic", () => {
  assert.equal(median([7, 1, 3]), 3);
  assert.equal(median([10, 2, 4, 8]), 6);
  assert.equal(median([]), null);
  assert.equal(isBotIdentity({ login: "dependabot[bot]", type: "Bot" }), true);
  assert.equal(isBotIdentity({ login: "Yo-DDV", type: "User" }), false);
});

test("activity uses one rolling 30-day UTC window and factual scopes", () => {
  const now = new Date("2026-07-25T12:00:00Z");
  const metrics = buildRepositoryActivity({
    commits: [
      commit({ sha: "outside", date: "2026-06-25T23:59:59Z", login: "outside" }),
      commit({ sha: "start", date: "2026-06-26T00:00:00Z", login: "Yo-DDV" }),
      commit({ sha: "bot", date: "2026-07-20T08:00:00Z", login: "dependabot[bot]", type: "Bot" }),
      commit({ sha: "future", date: "2026-07-25T12:00:01Z", login: "future" })
    ],
    pullRequests: [
      pr({ number: 1, createdAt: "2026-07-18T08:00:00Z", mergedAt: "2026-07-20T08:00:00Z", reviews: [
        review({ submittedAt: "2026-07-18T09:00:00Z", login: "Yo-DDV" }),
        review({ submittedAt: "2026-07-18T10:00:00Z", login: "review-bot[bot]", type: "Bot" }),
        review({ submittedAt: "2026-07-18T20:00:00Z", login: "reviewer" }),
        review({ submittedAt: "2026-07-21T08:00:00Z", login: "late" })
      ] }),
      pr({ number: 2, createdAt: "2026-07-22T00:00:00Z", mergedAt: "2026-07-24T00:00:00Z", login: "release-bot[bot]", type: "Bot" })
    ],
    issues: [
      { number: 10, closed_at: "2026-07-21T03:00:00Z" },
      { number: 11, closed_at: "2026-07-21T04:00:00Z", pull_request: { url: "x" } },
      { number: 12, closed_at: "2026-06-25T23:59:59Z" }
    ],
    commitStats: { start: { additions: 12, deletions: 3, filesChanged: 2 }, bot: { additions: 4, deletions: 7, filesChanged: 1 } },
    now
  });
  assert.deepEqual(metrics.window, { kind: "rolling-30-utc-days", days: 30, start: "2026-06-26T00:00:00.000Z", end: "2026-07-25T12:00:00.000Z", currentDayPartial: true });
  assert.deepEqual(metrics.headline, { commits: 2, mergedPullRequests: 2, issuesClosed: 1, activeHumanContributors: 1 });
  assert.deepEqual(metrics.codeMovement, { additions: 16, deletions: 10, filesChanged: 3 });
  assert.deepEqual(metrics.automation, { commits: 1, mergedPullRequests: 1 });
  assert.equal(metrics.flow.medianPrLeadTimeHours, 48);
  assert.equal(metrics.flow.medianFirstReviewHours, 12);
  assert.equal(metrics.flow.reviewedPullRequests, 1);
  assert.equal(metrics.daily.length, 30);
  assert.equal(metrics.daily[0].date, "2026-06-26");
  assert.equal(metrics.daily.at(-1).date, "2026-07-25");
  assert.equal(metrics.daily.find((d) => d.date === "2026-07-20").medianPrLeadTimeHours, 48);
  assert.equal(metrics.daily.find((d) => d.date === "2026-07-21").issuesClosed, 1);
});

test("unlinked human authors remain countable and bot-like names stay automation", () => {
  const metrics = buildRepositoryActivity({ commits: [
    commit({ sha: "human", date: "2026-07-25T01:00:00Z", login: null, name: "Local Author" }),
    commit({ sha: "bot", date: "2026-07-25T02:00:00Z", login: null, name: "release bot" })
  ], now: new Date("2026-07-25T12:00:00Z") });
  assert.equal(metrics.headline.activeHumanContributors, 1);
  assert.equal(metrics.automation.commits, 1);
});

test("localized SVGs are responsive, theme-aware and do not duplicate the README heading", () => {
  const metrics = buildRepositoryActivity({
    commits: [commit({ sha: "a", date: "2026-07-25T01:00:00Z", login: "Yo-DDV" })],
    pullRequests: [pr({ number: 1, createdAt: "2026-07-24T01:00:00Z", mergedAt: "2026-07-25T01:00:00Z", reviews: [review({ submittedAt: "2026-07-24T05:00:00Z", login: "reviewer" })] })],
    issues: [{ number: 2, closed_at: "2026-07-25T02:00:00Z" }],
    commitStats: { a: { additions: 5, deletions: 2, filesChanged: 1 } },
    now: new Date("2026-07-25T12:00:00Z")
  });
  assert.deepEqual(Object.keys(ACTIVITY_LOCALES), ["en", "fr", "de", "es", "pt"]);
  for (const [locale, copy] of Object.entries(ACTIVITY_LOCALES)) {
    for (const mobile of [false, true]) {
      const svg = renderRepositoryActivitySvg(metrics, locale, mobile);
      assert.match(svg, /^<svg /);
      assert.match(svg, /role="img"/);
      assert.match(svg, /@media\(prefers-color-scheme:dark\)/);
      assert.match(svg, /GitHub Actions/);
      assert.doesNotMatch(svg, /Development pulse|Dynamique du développement|Entwicklungsdynamik|Ritmo de desarrollo|Ritmo de desenvolvimento/);
      const visible = svg.replace(/<title[\s\S]*?<\/title>/, "").replace(/<desc[\s\S]*?<\/desc>/, "");
      assert.equal(visible.includes(copy.ariaTitle), false);
      assert.equal(visible.includes("Yo-DDV"), false);
      assert.match(svg, mobile ? /width="420" height="1572"/ : /width="1200" height="850"/);
    }
  }
});

test("renderer rejects incomplete payloads and unsupported locales", () => {
  assert.throws(() => renderRepositoryActivitySvg({}, "en"), /Invalid repository-activity metrics payload/);
  const metrics = buildRepositoryActivity({ now: new Date("2026-07-25T12:00:00Z") });
  assert.throws(() => renderRepositoryActivitySvg(metrics, "it"), /Unsupported repository-activity locale/);
});
