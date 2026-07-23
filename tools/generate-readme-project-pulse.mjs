import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  LOCALES,
  buildMetrics,
  renderActivitySvg,
  renderContributorsSvg,
  renderHeroSvg
} from "./generate-readme-metrics.mjs";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "Yo-DDV/Towk";
const DEFAULT_BRANCH = "main";
const DEFAULT_BASELINE_SHA = "205e91fe1ae5e5c23420974f7e04cf82456eeab3";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), ".context/readme-metrics");
const PAGE_SIZE = 100;
const MAX_COMPARE_PAGES = 50;
const MAX_PULL_REQUEST_PAGES = 20;
const METRICS_VERSION = 2;

export const PULSE_LOCALE_OVERRIDES = {
  en: {
    pulseSubtitle: "Towk activity since the independent baseline",
    contributorsSubtitle: "Human authors since the independent baseline",
    period: "independent Towk · since 12 Jul 2026",
    botsNote: "Bots are reported separately."
  },
  fr: {
    pulseSubtitle: "Activité Towk depuis le dépôt autonome",
    contributorsSubtitle: "Auteurs humains depuis le dépôt autonome",
    period: "Towk indépendant · depuis le 12 juil. 2026",
    botsNote: "Les robots sont présentés séparément."
  },
  de: {
    pulseSubtitle: "Towk-Aktivität seit dem Standalone-Start",
    contributorsSubtitle: "Menschliche Autoren seit dem Standalone-Start",
    period: "eigenständiges Towk · seit 12. Jul. 2026",
    botsNote: "Bots werden separat ausgewiesen."
  },
  es: {
    pulseSubtitle: "Actividad Towk desde el repositorio independiente",
    contributorsSubtitle: "Autores humanos desde el repositorio independiente",
    period: "Towk independiente · desde el 12 jul. 2026",
    botsNote: "Los bots se muestran por separado."
  },
  pt: {
    pulseSubtitle: "Atividade Towk desde o repositório independente",
    contributorsSubtitle: "Autores humanos desde o repositório independente",
    period: "Towk independente · desde 12 jul. 2026",
    botsNote: "Os bots são apresentados separadamente."
  }
};

export function assertRepository(value) {
  const match = String(value).match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!match) throw new Error("Repository must use the owner/name format");
  return { fullName: String(value), owner: match[1], name: match[2] };
}

export function assertBranch(value) {
  if (!/^(?![./])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]{1,200}$/.test(String(value))) {
    throw new Error("Invalid branch name");
  }
  return String(value);
}

export function assertCommitSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(String(value))) throw new Error("Invalid Git commit SHA");
  return String(value).toLowerCase();
}

export function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function dateFromCommit(commit) {
  const value = commit?.commit?.committer?.date ?? commit?.commit?.author?.date;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromPullRequest(pullRequest) {
  const date = new Date(pullRequest?.merged_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function filterPullRequestsAfterBaseline(pullRequests, baselineAt, now) {
  const baseline = new Date(baselineAt);
  const snapshot = new Date(now);
  if (Number.isNaN(baseline.getTime()) || Number.isNaN(snapshot.getTime())) {
    throw new Error("Invalid pull-request reporting window");
  }
  return pullRequests.filter((pullRequest) => {
    const mergedAt = dateFromPullRequest(pullRequest);
    return mergedAt && mergedAt > baseline && mergedAt <= snapshot;
  });
}

function applyLocaleOverrides() {
  for (const [locale, overrides] of Object.entries(PULSE_LOCALE_OVERRIDES)) {
    if (!LOCALES[locale]) throw new Error(`Missing renderer locale: ${locale}`);
    Object.assign(LOCALES[locale], overrides);
  }
}

async function githubRequest(url, token) {
  const target = new URL(url, API_ROOT);
  if (target.origin !== API_ROOT) throw new Error("Refusing a non-GitHub API request");
  const response = await fetch(target, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "towk-readme-project-pulse",
      "X-GitHub-Api-Version": API_VERSION
    }
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).message ?? detail; } catch { /* bounded text is enough */ }
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return { data: text ? JSON.parse(text) : null, link: response.headers.get("link") };
}

async function fetchPages(initialUrl, token, maxPages) {
  const output = [];
  let next = initialUrl;
  for (let page = 0; next && page < maxPages; page += 1) {
    const response = await githubRequest(next, token);
    if (!Array.isArray(response.data)) throw new Error("Expected an array from GitHub");
    output.push(...response.data);
    next = parseNextLink(response.link);
  }
  if (next) throw new Error(`GitHub pagination exceeded ${maxPages} pages`);
  return output;
}

async function fetchComparison({ owner, name, branch, baselineSha, token }) {
  const commits = [];
  let totalCommits = null;
  let baselineAt = null;
  for (let page = 1; page <= MAX_COMPARE_PAGES; page += 1) {
    const url = `/repos/${owner}/${name}/compare/${encodeURIComponent(baselineSha)}...${encodeURIComponent(branch)}?per_page=${PAGE_SIZE}&page=${page}`;
    const response = await githubRequest(url, token);
    if (!response.data || !Array.isArray(response.data.commits)) {
      throw new Error("Expected a commit comparison from GitHub");
    }
    if (response.data.status !== "ahead" && response.data.status !== "identical") {
      throw new Error(`Metrics baseline is not an ancestor of ${branch}`);
    }
    if (totalCommits === null) {
      totalCommits = Number(response.data.total_commits ?? 0);
      baselineAt = dateFromCommit(response.data.base_commit);
      if (!baselineAt) throw new Error("GitHub comparison did not expose the baseline date");
    }
    commits.push(...response.data.commits);
    if (commits.length >= totalCommits) {
      return { commits: commits.slice(0, totalCommits), baselineAt };
    }
    if (response.data.commits.length === 0) break;
  }
  throw new Error(`GitHub comparison exceeded ${MAX_COMPARE_PAGES} pages`);
}

export async function fetchProjectPulse({ repository, branch, baselineSha, token, now = new Date() }) {
  if (!token) throw new Error("GITHUB_TOKEN is required for live metrics");
  const { owner, name } = assertRepository(repository);
  const safeBranch = assertBranch(branch);
  const safeBaselineSha = assertCommitSha(baselineSha);
  const snapshot = new Date(now);
  if (Number.isNaN(snapshot.getTime())) throw new Error("Invalid snapshot date");

  const pullsUrl = `/repos/${owner}/${name}/pulls?state=closed&base=${encodeURIComponent(safeBranch)}&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
  const [comparison, closedPullRequests] = await Promise.all([
    fetchComparison({ owner, name, branch: safeBranch, baselineSha: safeBaselineSha, token }),
    fetchPages(pullsUrl, token, MAX_PULL_REQUEST_PAGES)
  ]);
  return {
    commits: comparison.commits,
    pullRequests: filterPullRequestsAfterBaseline(closedPullRequests, comparison.baselineAt, snapshot),
    baselineSha: safeBaselineSha,
    baselineAt: comparison.baselineAt.toISOString(),
    to: snapshot.toISOString()
  };
}

export async function writeProjectPulseAssets({
  outputDir,
  metrics,
  repository,
  branch,
  sourceCommit,
  baselineSha,
  baselineAt
}) {
  applyLocaleOverrides();
  await mkdir(outputDir, { recursive: true });
  for (const locale of Object.keys(PULSE_LOCALE_OVERRIDES)) {
    const localeDir = path.join(outputDir, locale);
    await mkdir(localeDir, { recursive: true });
    const assets = {
      "hero.svg": renderHeroSvg(locale, false),
      "hero-mobile.svg": renderHeroSvg(locale, true),
      "activity.svg": renderActivitySvg(metrics, locale, false),
      "activity-mobile.svg": renderActivitySvg(metrics, locale, true),
      "contributors.svg": renderContributorsSvg(metrics, locale, false),
      "contributors-mobile.svg": renderContributorsSvg(metrics, locale, true)
    };
    await Promise.all(Object.entries(assets).map(([name, content]) =>
      writeFile(path.join(localeDir, name), content, { encoding: "utf8", mode: 0o644 })
    ));
  }

  const publicMetrics = {
    version: METRICS_VERSION,
    repository,
    branch,
    sourceCommit: sourceCommit || null,
    generatedAt: metrics.generatedAt,
    window: "since-independent-baseline",
    baselineCommit: baselineSha,
    baselineAt,
    commits: metrics.commits,
    mergedPullRequests: metrics.mergedPullRequests,
    activeDays: metrics.activeDays,
    humanCommitAuthors: metrics.humanCommitAuthors,
    automationCommits: metrics.automationCommits,
    automationPullRequests: metrics.automationPullRequests,
    commitAuthors: metrics.commitAuthors,
    pullRequestAuthors: metrics.pullRequestAuthors,
    daily: metrics.daily,
    weekly: metrics.weekly,
    monthlyCommits: metrics.monthlyCommitsByLocale.en,
    monthlyPullRequests: metrics.monthlyPullRequestsByLocale.en
  };
  await writeFile(path.join(outputDir, "metrics.json"), `${JSON.stringify(publicMetrics, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(outputDir, "README.md"),
    `# Generated Towk README metrics\n\nThis branch is generated by \`.github/workflows/refresh-readme-metrics.yml\`.\n\n- Source repository: \`${repository}\`\n- Source branch: \`${branch}\`\n- Source commit: \`${sourceCommit || "unknown"}\`\n- Generated: \`${metrics.generatedAt}\`\n- Window: after independent Towk baseline \`${baselineSha}\` (${baselineAt})\n\nDo not edit generated SVG or JSON files manually.\n`,
    "utf8"
  );
}

export async function generateProjectPulse({ outputDir = DEFAULT_OUTPUT_DIR, now = new Date() } = {}) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.TOWK_METRICS_SOURCE_BRANCH || DEFAULT_BRANCH;
  const baselineSha = process.env.TOWK_METRICS_BASELINE_SHA || DEFAULT_BASELINE_SHA;
  const source = await fetchProjectPulse({
    repository,
    branch,
    baselineSha,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    now
  });
  const metrics = buildMetrics(source.commits, source.pullRequests, now);
  await writeProjectPulseAssets({
    outputDir,
    metrics,
    repository,
    branch,
    sourceCommit: process.env.GITHUB_SHA,
    baselineSha: source.baselineSha,
    baselineAt: source.baselineAt
  });
  return { outputDir, repository, branch, ...source, metrics };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outputArgumentIndex = process.argv.indexOf("--output");
  const outputDir = outputArgumentIndex >= 0
    ? path.resolve(process.argv[outputArgumentIndex + 1] || "")
    : (process.env.TOWK_METRICS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  if (outputArgumentIndex >= 0 && !process.argv[outputArgumentIndex + 1]) {
    process.stderr.write("--output requires a path\n");
    process.exitCode = 1;
  } else {
    generateProjectPulse({ outputDir }).then((result) => {
      process.stdout.write(`Generated independent Towk README pulse in ${result.outputDir}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
