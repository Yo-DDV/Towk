import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { renderHeroSvg } from "./generate-readme-metrics.mjs";
import { ACTIVITY_LOCALES, buildRepositoryActivity, renderRepositoryActivitySvg } from "./generate-readme-repository-activity.mjs";

const execFile = promisify(execFileCallback);
const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "Yo-DDV/Towk";
const DEFAULT_BRANCH = "main";
const DEFAULT_BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), ".context/readme-metrics");
const PAGE_SIZE = 100;
const MAX_COMPARE_PAGES = 50;
const MAX_PULL_REQUEST_PAGES = 20;
const MAX_ISSUE_PAGES = 20;
const MAX_REVIEW_PAGES = 5;
const REVIEW_CONCURRENCY = 5;
const WINDOW_DAYS = 30;
const METRICS_VERSION = 3;

export function assertRepository(value) {
  const match = String(value).match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!match) throw new Error("Repository must use the owner/name format");
  return { fullName: String(value), owner: match[1], name: match[2] };
}
export function assertBranch(value) {
  if (!/^(?![./])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]{1,200}$/.test(String(value))) throw new Error("Invalid branch name");
  return String(value);
}
export function assertCommitSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(String(value))) throw new Error("Invalid Git commit SHA");
  return String(value).toLowerCase();
}
export function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) { const match = part.match(/<([^>]+)>;\s*rel="next"/); if (match) return match[1]; }
  return null;
}
function validDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function utcDay(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
function addUtcDays(date, amount) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next; }
function dateFromCommit(item) { return validDate(item?.commit?.committer?.date ?? item?.commit?.author?.date); }
function dateFromPr(item) { return validDate(item?.merged_at); }
function dateFromIssue(item) { return validDate(item?.closed_at); }
function inWindow(date, from, to) { return date && date >= from && date <= to; }

export function filterPullRequestsForWindow(items, from, to) {
  const start = validDate(from), end = validDate(to);
  if (!start || !end || end < start) throw new Error("Invalid pull-request reporting window");
  return items.filter((item) => inWindow(dateFromPr(item), start, end));
}
export function filterIssuesForWindow(items, from, to) {
  const start = validDate(from), end = validDate(to);
  if (!start || !end || end < start) throw new Error("Invalid issue reporting window");
  return items.filter((item) => !item?.pull_request && inWindow(dateFromIssue(item), start, end));
}

async function githubRequest(url, token) {
  const target = new URL(url, API_ROOT);
  if (target.origin !== API_ROOT) throw new Error("Refusing a non-GitHub API request");
  const response = await fetch(target, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "towk-readme-repository-activity", "X-GitHub-Api-Version": API_VERSION } });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300); try { detail = JSON.parse(text).message ?? detail; } catch { /* bounded response */ }
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return { data: text ? JSON.parse(text) : null, link: response.headers.get("link") };
}
async function fetchArrayPages(initialUrl, token, maxPages) {
  const output = []; let next = initialUrl;
  for (let page = 0; next && page < maxPages; page += 1) {
    const response = await githubRequest(next, token);
    if (!Array.isArray(response.data)) throw new Error("Expected an array from GitHub");
    output.push(...response.data); next = parseNextLink(response.link);
  }
  if (next) throw new Error(`GitHub pagination exceeded ${maxPages} pages`);
  return output;
}
async function fetchComparison({ owner, name, branch, baselineSha, token }) {
  const commits = []; let total = null; let baselineAt = null;
  for (let page = 1; page <= MAX_COMPARE_PAGES; page += 1) {
    const response = await githubRequest(`/repos/${owner}/${name}/compare/${encodeURIComponent(baselineSha)}...${encodeURIComponent(branch)}?per_page=${PAGE_SIZE}&page=${page}`, token);
    if (!response.data || !Array.isArray(response.data.commits)) throw new Error("Expected a commit comparison from GitHub");
    if (!["ahead", "identical"].includes(response.data.status)) throw new Error(`Metrics baseline is not an ancestor of ${branch}`);
    if (total === null) {
      total = Number(response.data.total_commits ?? 0); baselineAt = dateFromCommit(response.data.base_commit);
      if (!baselineAt) throw new Error("GitHub comparison did not expose the baseline date");
    }
    commits.push(...response.data.commits);
    if (commits.length >= total) return { commits: commits.slice(0, total), baselineAt };
    if (!response.data.commits.length) break;
  }
  throw new Error(`GitHub comparison exceeded ${MAX_COMPARE_PAGES} pages`);
}
async function fetchClosedPrs({ owner, name, branch, token, from }) {
  const output = []; let next = `/repos/${owner}/${name}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
  for (let page = 0; next && page < MAX_PULL_REQUEST_PAGES; page += 1) {
    const response = await githubRequest(next, token);
    if (!Array.isArray(response.data)) throw new Error("Expected pull requests from GitHub");
    output.push(...response.data);
    const oldest = response.data.map((item) => validDate(item?.updated_at)).filter(Boolean).sort((a, b) => a - b)[0];
    next = response.data.length < PAGE_SIZE || (oldest && oldest < from) ? null : parseNextLink(response.link);
  }
  if (next) throw new Error(`GitHub pull-request pagination exceeded ${MAX_PULL_REQUEST_PAGES} pages`);
  return output;
}
async function mapConcurrent(items, limit, mapper) {
  const output = new Array(items.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; output[index] = await mapper(items[index]); }
  });
  await Promise.all(workers); return output;
}
async function attachReviews({ owner, name, items, token }) {
  return mapConcurrent(items, REVIEW_CONCURRENCY, async (item) => {
    const number = Number(item?.number); if (!Number.isInteger(number) || number <= 0) throw new Error("Pull request is missing a valid number");
    const reviews = await fetchArrayPages(`/repos/${owner}/${name}/pulls/${number}/reviews?per_page=${PAGE_SIZE}`, token, MAX_REVIEW_PAGES);
    return { ...item, reviews };
  });
}

export function parseNumstatLog(output) {
  const stats = new Map(); let current = null;
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith("commit:")) {
      const sha = line.slice(7).trim().toLowerCase(); current = /^[0-9a-f]{40}$/.test(sha) ? sha : null;
      if (current && !stats.has(current)) stats.set(current, { additions: 0, deletions: 0, filesChanged: 0 });
      continue;
    }
    if (!current || !line.includes("\t")) continue;
    const [added, deleted] = line.split("\t", 3); const value = stats.get(current); value.filesChanged += 1;
    if (/^\d+$/.test(added)) value.additions += Number(added);
    if (/^\d+$/.test(deleted)) value.deletions += Number(deleted);
  }
  return stats;
}
export async function collectCommitStats({ baselineSha, branch, cwd = process.cwd() }) {
  const { stdout } = await execFile("git", ["-c", "core.quotepath=false", "log", "--format=commit:%H", "--numstat", "--no-renames", `${assertCommitSha(baselineSha)}..${assertBranch(branch)}`], { cwd, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return parseNumstatLog(stdout);
}

export async function fetchProjectPulse({ repository, branch, baselineSha, token, now = new Date() }) {
  if (!token) throw new Error("GITHUB_TOKEN is required for live metrics");
  const { owner, name } = assertRepository(repository); const safeBranch = assertBranch(branch); const safeBaseline = assertCommitSha(baselineSha); const snapshot = validDate(now);
  if (!snapshot) throw new Error("Invalid snapshot date");
  const comparison = await fetchComparison({ owner, name, branch: safeBranch, baselineSha: safeBaseline, token });
  const rollingStart = addUtcDays(utcDay(snapshot), 1 - WINDOW_DAYS); const effectiveStart = rollingStart > comparison.baselineAt ? rollingStart : comparison.baselineAt;
  const [closedPrs, closedIssues] = await Promise.all([
    fetchClosedPrs({ owner, name, branch: safeBranch, token, from: effectiveStart }),
    fetchArrayPages(`/repos/${owner}/${name}/issues?state=closed&sort=updated&direction=desc&since=${encodeURIComponent(effectiveStart.toISOString())}&per_page=${PAGE_SIZE}`, token, MAX_ISSUE_PAGES)
  ]);
  const selectedPrs = filterPullRequestsForWindow(closedPrs, effectiveStart, snapshot);
  const [pullRequests, issues] = await Promise.all([
    attachReviews({ owner, name, items: selectedPrs, token }),
    Promise.resolve(filterIssuesForWindow(closedIssues, effectiveStart, snapshot))
  ]);
  return { commits: comparison.commits, pullRequests, issues, baselineSha: safeBaseline, baselineAt: comparison.baselineAt.toISOString(), effectiveStart: effectiveStart.toISOString(), to: snapshot.toISOString() };
}

export async function writeProjectPulseAssets({ outputDir, metrics, repository, branch, sourceCommit, baselineSha, baselineAt, effectiveStart }) {
  await mkdir(outputDir, { recursive: true });
  for (const locale of Object.keys(ACTIVITY_LOCALES)) {
    const localeDir = path.join(outputDir, locale); await mkdir(localeDir, { recursive: true });
    const assets = { "hero.svg": renderHeroSvg(locale, false), "hero-mobile.svg": renderHeroSvg(locale, true), "activity.svg": renderRepositoryActivitySvg(metrics, locale, false), "activity-mobile.svg": renderRepositoryActivitySvg(metrics, locale, true) };
    await Promise.all(Object.entries(assets).map(([name, content]) => writeFile(path.join(localeDir, name), content, { encoding: "utf8", mode: 0o644 })));
  }
  const snapshot = { version: METRICS_VERSION, repository, branch, sourceCommit: sourceCommit || null, generatedAt: metrics.generatedAt, window: metrics.window, baselineCommit: baselineSha, baselineAt, effectiveWindowStart: effectiveStart, headline: metrics.headline, flow: metrics.flow, codeMovement: metrics.codeMovement, automation: metrics.automation, daily: metrics.daily };
  await writeFile(path.join(outputDir, "metrics.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "README.md"), `# Generated Towk README repository activity\n\nThis branch is generated by \`.github/workflows/refresh-readme-metrics.yml\`.\n\n- Source repository: \`${repository}\`\n- Source branch: \`${branch}\`\n- Source commit: \`${sourceCommit || "unknown"}\`\n- Generated: \`${metrics.generatedAt}\`\n- Rolling window: \`${metrics.window.start}\` to \`${metrics.window.end}\`\n- Independent baseline: \`${baselineSha}\` (${baselineAt})\n- Effective data start: \`${effectiveStart}\`\n\nDo not edit generated SVG or JSON files manually.\n`, "utf8");
}

export async function generateProjectPulse({ outputDir = DEFAULT_OUTPUT_DIR, now = new Date(), cwd = process.cwd() } = {}) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY, branch = process.env.TOWK_METRICS_SOURCE_BRANCH || DEFAULT_BRANCH, baselineSha = process.env.TOWK_METRICS_BASELINE_SHA || DEFAULT_BASELINE_SHA;
  const source = await fetchProjectPulse({ repository, branch, baselineSha, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN, now });
  const commitStats = await collectCommitStats({ baselineSha: source.baselineSha, branch, cwd });
  const metrics = buildRepositoryActivity({ commits: source.commits, pullRequests: source.pullRequests, issues: source.issues, commitStats, now });
  await writeProjectPulseAssets({ outputDir, metrics, repository, branch, sourceCommit: process.env.GITHUB_SHA, baselineSha: source.baselineSha, baselineAt: source.baselineAt, effectiveStart: source.effectiveStart });
  return { outputDir, repository, branch, ...source, metrics };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const index = process.argv.indexOf("--output"); const outputDir = index >= 0 ? path.resolve(process.argv[index + 1] || "") : (process.env.TOWK_METRICS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  if (index >= 0 && !process.argv[index + 1]) { process.stderr.write("--output requires a path\n"); process.exitCode = 1; }
  else generateProjectPulse({ outputDir }).then((result) => process.stdout.write(`Generated Towk repository activity in ${result.outputDir}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
