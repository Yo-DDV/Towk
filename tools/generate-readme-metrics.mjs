import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "Yo-DDV/Towk";
const DEFAULT_BRANCH = "main";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), ".context/readme-metrics");
const MAX_COMMIT_PAGES = 50;
const MAX_PULL_REQUEST_PAGES = 20;
const PAGE_SIZE = 100;
const METRICS_VERSION = 1;

export const LOCALES = {
  en: {
    language: "English",
    heroEyebrow: "FOCUSED · SELF-HOSTED · OPEN SOURCE",
    heroTitle: "Own your communication stack.",
    heroSubtitle: "Messages, files, notifications and calls — operated on infrastructure you choose.",
    heroChips: ["Self-hosted", "Installable PWA", "Voice & video", "Open source"],
    pulseTitle: "Development pulse",
    pulseSubtitle: "Main-branch activity over the trailing twelve months",
    kpiCommits: "commits",
    kpiPullRequests: "merged pull requests",
    kpiActiveDays: "active days",
    kpiAuthors: "human commit authors",
    dailyTitle: "Commits per day",
    dailySubtitle: "Last 30 days",
    weeklyTitle: "Commits per week",
    weeklySubtitle: "Last 12 weeks",
    monthlyCommitsTitle: "Commits per month",
    monthlyPullRequestsTitle: "Merged PRs per month",
    contributorsTitle: "Who is moving Towk forward",
    contributorsSubtitle: "Human authors on main and merged pull requests · trailing twelve months",
    commitAuthors: "Commit authors",
    pullRequestAuthors: "Merged PR authors",
    noActivity: "No activity in this window",
    otherAuthors: "Other authors",
    automation: "Automation",
    updated: "Updated",
    period: "main branch · trailing 12 months",
    botsNote: "Bots are excluded from contributor rankings and reported separately.",
    commitsWord: "commits",
    prsWord: "PRs"
  },
  fr: {
    language: "Français",
    heroEyebrow: "CIBLÉ · AUTO-HÉBERGÉ · OPEN SOURCE",
    heroTitle: "Reprenez la main sur votre communication.",
    heroSubtitle: "Messages, fichiers, notifications et appels — sur l’infrastructure que vous choisissez.",
    heroChips: ["Auto-hébergé", "PWA installable", "Voix et vidéo", "Open source"],
    pulseTitle: "Dynamique du développement",
    pulseSubtitle: "Activité de la branche principale sur les douze derniers mois",
    kpiCommits: "commits",
    kpiPullRequests: "pull requests fusionnées",
    kpiActiveDays: "jours actifs",
    kpiAuthors: "auteurs humains de commits",
    dailyTitle: "Commits par jour",
    dailySubtitle: "30 derniers jours",
    weeklyTitle: "Commits par semaine",
    weeklySubtitle: "12 dernières semaines",
    monthlyCommitsTitle: "Commits par mois",
    monthlyPullRequestsTitle: "PR fusionnées par mois",
    contributorsTitle: "Qui fait avancer Towk",
    contributorsSubtitle: "Auteurs humains sur main et pull requests fusionnées · douze derniers mois",
    commitAuthors: "Auteurs de commits",
    pullRequestAuthors: "Auteurs de PR fusionnées",
    noActivity: "Aucune activité sur cette période",
    otherAuthors: "Autres auteurs",
    automation: "Automatisation",
    updated: "Mis à jour",
    period: "branche main · 12 derniers mois",
    botsNote: "Les robots sont exclus des classements et présentés séparément.",
    commitsWord: "commits",
    prsWord: "PR"
  },
  de: {
    language: "Deutsch",
    heroEyebrow: "FOKUSSIERT · SELBST GEHOSTET · OPEN SOURCE",
    heroTitle: "Betreibe Kommunikation zu deinen Bedingungen.",
    heroSubtitle: "Nachrichten, Dateien, Benachrichtigungen und Anrufe — auf einer Infrastruktur deiner Wahl.",
    heroChips: ["Selbst gehostet", "Installierbare PWA", "Sprache & Video", "Open Source"],
    pulseTitle: "Entwicklungsdynamik",
    pulseSubtitle: "Aktivität des main-Branches in den vergangenen zwölf Monaten",
    kpiCommits: "Commits",
    kpiPullRequests: "zusammengeführte Pull Requests",
    kpiActiveDays: "aktive Tage",
    kpiAuthors: "menschliche Commit-Autoren",
    dailyTitle: "Commits pro Tag",
    dailySubtitle: "Letzte 30 Tage",
    weeklyTitle: "Commits pro Woche",
    weeklySubtitle: "Letzte 12 Wochen",
    monthlyCommitsTitle: "Commits pro Monat",
    monthlyPullRequestsTitle: "Zusammengeführte PRs pro Monat",
    contributorsTitle: "Wer Towk voranbringt",
    contributorsSubtitle: "Menschliche Autoren auf main und zusammengeführte Pull Requests · zwölf Monate",
    commitAuthors: "Commit-Autoren",
    pullRequestAuthors: "Autoren zusammengeführter PRs",
    noActivity: "Keine Aktivität in diesem Zeitraum",
    otherAuthors: "Weitere Autoren",
    automation: "Automatisierung",
    updated: "Aktualisiert",
    period: "main-Branch · letzte 12 Monate",
    botsNote: "Bots sind aus den Ranglisten ausgeschlossen und werden separat ausgewiesen.",
    commitsWord: "Commits",
    prsWord: "PRs"
  },
  es: {
    language: "Español",
    heroEyebrow: "CENTRADO · AUTOALOJADO · CÓDIGO ABIERTO",
    heroTitle: "Controla tu espacio de comunicación.",
    heroSubtitle: "Mensajes, archivos, notificaciones y llamadas — en la infraestructura que tú elijas.",
    heroChips: ["Autoalojado", "PWA instalable", "Voz y vídeo", "Código abierto"],
    pulseTitle: "Ritmo de desarrollo",
    pulseSubtitle: "Actividad de la rama main durante los últimos doce meses",
    kpiCommits: "commits",
    kpiPullRequests: "pull requests fusionadas",
    kpiActiveDays: "días activos",
    kpiAuthors: "autores humanos de commits",
    dailyTitle: "Commits por día",
    dailySubtitle: "Últimos 30 días",
    weeklyTitle: "Commits por semana",
    weeklySubtitle: "Últimas 12 semanas",
    monthlyCommitsTitle: "Commits por mes",
    monthlyPullRequestsTitle: "PR fusionadas por mes",
    contributorsTitle: "Quién impulsa Towk",
    contributorsSubtitle: "Autores humanos en main y pull requests fusionadas · últimos doce meses",
    commitAuthors: "Autores de commits",
    pullRequestAuthors: "Autores de PR fusionadas",
    noActivity: "Sin actividad en este periodo",
    otherAuthors: "Otros autores",
    automation: "Automatización",
    updated: "Actualizado",
    period: "rama main · últimos 12 meses",
    botsNote: "Los bots no aparecen en los rankings y se muestran por separado.",
    commitsWord: "commits",
    prsWord: "PR"
  },
  pt: {
    language: "Português",
    heroEyebrow: "FOCADO · AUTOALOJADO · CÓDIGO ABERTO",
    heroTitle: "Controla o teu espaço de comunicação.",
    heroSubtitle: "Mensagens, ficheiros, notificações e chamadas — na infraestrutura que escolheres.",
    heroChips: ["Autoalojado", "PWA instalável", "Voz e vídeo", "Código aberto"],
    pulseTitle: "Ritmo de desenvolvimento",
    pulseSubtitle: "Atividade do ramo main nos últimos doze meses",
    kpiCommits: "commits",
    kpiPullRequests: "pull requests integradas",
    kpiActiveDays: "dias ativos",
    kpiAuthors: "autores humanos de commits",
    dailyTitle: "Commits por dia",
    dailySubtitle: "Últimos 30 dias",
    weeklyTitle: "Commits por semana",
    weeklySubtitle: "Últimas 12 semanas",
    monthlyCommitsTitle: "Commits por mês",
    monthlyPullRequestsTitle: "PR integradas por mês",
    contributorsTitle: "Quem faz o Towk avançar",
    contributorsSubtitle: "Autores humanos no main e pull requests integradas · últimos doze meses",
    commitAuthors: "Autores de commits",
    pullRequestAuthors: "Autores de PR integradas",
    noActivity: "Sem atividade neste período",
    otherAuthors: "Outros autores",
    automation: "Automatização",
    updated: "Atualizado",
    period: "ramo main · últimos 12 meses",
    botsNote: "Os bots são excluídos dos rankings e apresentados separadamente.",
    commitsWord: "commits",
    prsWord: "PR"
  }
};

const MONTH_LABELS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"],
  de: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
  pt: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
};

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function assertRepository(value) {
  const match = String(value).match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!match) throw new Error("Repository must use the owner/name format");
  return { fullName: value, owner: match[1], name: match[2] };
}

export function assertBranch(value) {
  if (!/^(?![./])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]{1,200}$/.test(String(value))) {
    throw new Error("Invalid branch name");
  }
  return String(value);
}

export function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function clampNumber(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

function formatNumber(value, locale = "en") {
  const numberLocale = { en: "en-US", fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-PT" }[locale] ?? "en-US";
  return new Intl.NumberFormat(numberLocale).format(clampNumber(value));
}

function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function startOfIsoWeek(date) {
  const day = utcDay(date);
  const weekday = day.getUTCDay() || 7;
  return addUtcDays(day, 1 - weekday);
}

function weekKey(date) {
  return dayKey(startOfIsoWeek(date));
}

function dateFromCommit(commit) {
  const raw = commit?.commit?.committer?.date ?? commit?.commit?.author?.date;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromPullRequest(pullRequest) {
  const date = new Date(pullRequest?.merged_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isBotIdentity(identity) {
  if (!identity) return false;
  const login = String(identity.login ?? identity.name ?? "");
  return identity.type === "Bot" || /\[bot\]$/i.test(login) || /^(?:github-actions|dependabot)(?:\[bot\])?$/i.test(login);
}

function displayCommitAuthor(commit) {
  if (commit?.author?.login) return { label: commit.author.login, bot: isBotIdentity(commit.author) };
  const name = String(commit?.commit?.author?.name ?? "Unlinked author").trim();
  return { label: name || "Unlinked author", bot: /bot/i.test(name) };
}

function displayPullRequestAuthor(pullRequest) {
  if (pullRequest?.user?.login) return { label: pullRequest.user.login, bot: isBotIdentity(pullRequest.user) };
  return { label: "Unlinked author", bot: false };
}

function countAuthors(items, resolver) {
  const humans = new Map();
  const bots = new Map();
  for (const item of items) {
    const author = resolver(item);
    const target = author.bot ? bots : humans;
    target.set(author.label, (target.get(author.label) ?? 0) + 1);
  }
  const sort = (map) => [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { humans: sort(humans), bots: sort(bots) };
}

function topAuthors(entries, limit, otherLabel) {
  if (entries.length <= limit) return entries;
  const visible = entries.slice(0, Math.max(1, limit - 1));
  const hiddenCount = entries.slice(visible.length).reduce((sum, entry) => sum + entry.count, 0);
  return [...visible, { label: otherLabel, count: hiddenCount }];
}

function makeDayBuckets(now, count) {
  const end = utcDay(now);
  return Array.from({ length: count }, (_, index) => {
    const date = addUtcDays(end, index - count + 1);
    return { key: dayKey(date), label: String(date.getUTCDate()), value: 0 };
  });
}

function makeWeekBuckets(now, count) {
  const end = startOfIsoWeek(now);
  return Array.from({ length: count }, (_, index) => {
    const start = addUtcDays(end, (index - count + 1) * 7);
    const endDate = addUtcDays(start, 6);
    return {
      key: weekKey(start),
      label: `${String(start.getUTCDate()).padStart(2, "0")}/${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      accessibleLabel: `${dayKey(start)} – ${dayKey(endDate)}`,
      value: 0
    };
  });
}

function makeMonthBuckets(now, count, locale) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + index - count + 1, 1));
    return {
      key: monthKey(date),
      label: MONTH_LABELS[locale][date.getUTCMonth()],
      accessibleLabel: `${MONTH_LABELS[locale][date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      value: 0
    };
  });
}

function fillBuckets(items, buckets, dateResolver, keyResolver) {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const item of items) {
    const date = dateResolver(item);
    if (!date) continue;
    const target = byKey.get(keyResolver(date));
    if (target) target.value += 1;
  }
  return buckets;
}

export function buildMetrics(commits, pullRequests, now = new Date()) {
  const snapshot = new Date(now);
  if (Number.isNaN(snapshot.getTime())) throw new Error("Invalid metrics snapshot date");

  const commitAuthors = countAuthors(commits, displayCommitAuthor);
  const pullRequestAuthors = countAuthors(pullRequests, displayPullRequestAuthor);
  const activeDays = new Set(commits.map(dateFromCommit).filter(Boolean).map(dayKey));

  const daily = fillBuckets(commits, makeDayBuckets(snapshot, 30), dateFromCommit, dayKey);
  const weekly = fillBuckets(commits, makeWeekBuckets(snapshot, 12), dateFromCommit, weekKey);
  const monthlyCommitsByLocale = {};
  const monthlyPullRequestsByLocale = {};
  for (const locale of Object.keys(LOCALES)) {
    monthlyCommitsByLocale[locale] = fillBuckets(
      commits,
      makeMonthBuckets(snapshot, 12, locale),
      dateFromCommit,
      monthKey
    );
    monthlyPullRequestsByLocale[locale] = fillBuckets(
      pullRequests,
      makeMonthBuckets(snapshot, 12, locale),
      dateFromPullRequest,
      monthKey
    );
  }

  return {
    version: METRICS_VERSION,
    generatedAt: snapshot.toISOString(),
    commits: commits.length,
    mergedPullRequests: pullRequests.length,
    activeDays: activeDays.size,
    humanCommitAuthors: commitAuthors.humans.length,
    automationCommits: commitAuthors.bots.reduce((sum, item) => sum + item.count, 0),
    automationPullRequests: pullRequestAuthors.bots.reduce((sum, item) => sum + item.count, 0),
    commitAuthors: commitAuthors.humans,
    pullRequestAuthors: pullRequestAuthors.humans,
    daily,
    weekly,
    monthlyCommitsByLocale,
    monthlyPullRequestsByLocale
  };
}

function svgStyles() {
  return `<style>
    .bg { fill: #ffffff; stroke: #d0d7de; }
    .panel { fill: #f6f8fa; stroke: #d8dee4; }
    .panel-strong { fill: #eef7ff; stroke: #b6d8ff; }
    .ink { fill: #18212f; }
    .muted { fill: #667085; }
    .faint { fill: #98a2b3; }
    .grid { stroke: #dfe5ec; }
    .track { fill: #e7edf3; }
    .title { font: 800 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subtitle { font: 500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .kpi { font: 800 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { font: 650 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .small { font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .body { font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .hero-eyebrow { font: 800 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 2px; }
    .hero-title { font: 850 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .hero-subtitle { font: 550 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .chip { font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117; stroke: #30363d; }
      .panel { fill: #161b22; stroke: #30363d; }
      .panel-strong { fill: #10263a; stroke: #244d70; }
      .ink { fill: #f0f6fc; }
      .muted { fill: #a7b0bc; }
      .faint { fill: #7d8590; }
      .grid { stroke: #30363d; }
      .track { fill: #27313d; }
    }
  </style>`;
}

function svgShell({ width, height, title, description, body, defs = "" }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#43d8b0"/>
      <stop offset="50%" stop-color="#4aa8ff"/>
      <stop offset="100%" stop-color="#7867f2"/>
    </linearGradient>
    <linearGradient id="accent-soft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#43d8b0" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#7867f2" stop-opacity="0.18"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    ${defs}
  </defs>
  ${svgStyles()}
  <rect class="bg" x="1" y="1" width="${width - 2}" height="${height - 2}" rx="22"/>
${body}
</svg>
`;
}

function textLines(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function renderHeroSvg(locale, mobile = false) {
  const copy = LOCALES[locale];
  if (!copy) throw new Error(`Unsupported locale: ${locale}`);
  const width = mobile ? 420 : 1200;
  const height = mobile ? 560 : 390;
  const titleLines = mobile
    ? textLines(copy.heroTitle, 20).slice(0, 3)
    : textLines(copy.heroTitle, 27).slice(0, 2);
  const subtitleLines = mobile
    ? textLines(copy.heroSubtitle, 36).slice(0, 3)
    : textLines(copy.heroSubtitle, 58).slice(0, 2);

  const chipMarkup = copy.heroChips.map((chip, index) => {
    if (mobile) {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 28 + column * 184;
      const y = 472 + row * 38;
      return `<g><rect x="${x}" y="${y}" width="172" height="30" rx="15" fill="url(#accent-soft)"/><text class="chip ink" x="${x + 86}" y="${y + 20}" text-anchor="middle">${escapeXml(chip)}</text></g>`;
    }
    const widths = [128, 150, 138, 126];
    const x = 48 + widths.slice(0, index).reduce((sum, value) => sum + value + 12, 0);
    return `<g><rect x="${x}" y="302" width="${widths[index]}" height="36" rx="18" fill="url(#accent-soft)"/><text class="chip ink" x="${x + widths[index] / 2}" y="325" text-anchor="middle">${escapeXml(chip)}</text></g>`;
  }).join("\n");

  if (mobile) {
    const titleMarkup = titleLines.map((line, index) => `<text class="hero-title ink" x="28" y="${88 + index * 43}" style="font-size:34px">${escapeXml(line)}</text>`).join("\n");
    const subtitleStart = 110 + titleLines.length * 43;
    const subtitleMarkup = subtitleLines.map((line, index) => `<text class="hero-subtitle muted" x="28" y="${subtitleStart + index * 23}" style="font-size:15.5px">${escapeXml(line)}</text>`).join("\n");
    return svgShell({
      width,
      height,
      title: copy.heroTitle,
      description: copy.heroSubtitle,
      body: `  <circle cx="365" cy="52" r="80" fill="#7867f2" opacity="0.18" filter="url(#glow)"/>
  <circle cx="58" cy="430" r="74" fill="#43d8b0" opacity="0.14" filter="url(#glow)"/>
  <rect x="0" y="0" width="420" height="9" rx="4" fill="url(#accent)"/>
  <text class="hero-eyebrow" x="28" y="43" fill="#4aa8ff" style="font-size:11px;letter-spacing:1.4px">${escapeXml(copy.heroEyebrow)}</text>
${titleMarkup}
${subtitleMarkup}
  <g transform="translate(28 300)">
    <rect class="panel" x="0" y="0" width="364" height="142" rx="18"/>
    <rect x="18" y="18" width="88" height="106" rx="14" fill="#7867f2" opacity="0.14"/>
    <circle cx="42" cy="46" r="8" fill="#43d8b0"/>
    <rect x="58" y="39" width="34" height="8" rx="4" fill="#4aa8ff" opacity="0.78"/>
    <circle cx="42" cy="76" r="8" fill="#4aa8ff"/>
    <rect x="58" y="69" width="28" height="8" rx="4" fill="#7867f2" opacity="0.82"/>
    <circle cx="42" cy="106" r="8" fill="#7867f2"/>
    <rect x="58" y="99" width="38" height="8" rx="4" fill="#43d8b0" opacity="0.76"/>
    <rect x="126" y="18" width="218" height="48" rx="14" fill="#4aa8ff" opacity="0.13"/>
    <circle cx="148" cy="42" r="9" fill="#4aa8ff"/>
    <rect x="166" y="33" width="122" height="8" rx="4" fill="#4aa8ff" opacity="0.58"/>
    <rect x="166" y="47" width="78" height="7" rx="3.5" fill="#98a2b3" opacity="0.52"/>
    <rect x="126" y="78" width="162" height="46" rx="14" fill="#43d8b0" opacity="0.14"/>
    <circle cx="148" cy="101" r="9" fill="#43d8b0"/>
    <rect x="166" y="92" width="96" height="8" rx="4" fill="#43d8b0" opacity="0.62"/>
    <rect x="166" y="106" width="62" height="7" rx="3.5" fill="#98a2b3" opacity="0.52"/>
    <rect x="300" y="78" width="44" height="46" rx="14" fill="#7867f2" opacity="0.18"/>
    <path d="M315 98h14M322 91v14" stroke="#7867f2" stroke-width="3" stroke-linecap="round"/>
  </g>
${chipMarkup}`
    });
  }

  const titleMarkup = titleLines.map((line, index) => `<text class="hero-title ink" x="48" y="${132 + index * 51}" style="font-size:42px">${escapeXml(line)}</text>`).join("\n");
  const subtitleStart = 132 + (titleLines.length - 1) * 51 + 45;
  const subtitleMarkup = subtitleLines.map((line, index) => `<text class="hero-subtitle muted" x="48" y="${subtitleStart + index * 27}" style="font-size:18px">${escapeXml(line)}</text>`).join("\n");
  return svgShell({
    width,
    height,
    title: copy.heroTitle,
    description: copy.heroSubtitle,
    body: `  <circle cx="1058" cy="42" r="150" fill="#7867f2" opacity="0.16" filter="url(#glow)"/>
  <circle cx="740" cy="360" r="130" fill="#43d8b0" opacity="0.12" filter="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="10" rx="5" fill="url(#accent)"/>
  <text class="hero-eyebrow" x="48" y="70" fill="#4aa8ff">${escapeXml(copy.heroEyebrow)}</text>
${titleMarkup}
${subtitleMarkup}
${chipMarkup}
  <g transform="translate(760 58)">
    <rect class="panel" x="0" y="0" width="415" height="275" rx="24"/>
    <rect x="20" y="20" width="104" height="235" rx="18" fill="#7867f2" opacity="0.13"/>
    <circle cx="48" cy="58" r="10" fill="#43d8b0"/>
    <rect x="66" y="50" width="42" height="9" rx="4.5" fill="#43d8b0" opacity="0.7"/>
    <circle cx="48" cy="102" r="10" fill="#4aa8ff"/>
    <rect x="66" y="94" width="34" height="9" rx="4.5" fill="#4aa8ff" opacity="0.72"/>
    <circle cx="48" cy="146" r="10" fill="#7867f2"/>
    <rect x="66" y="138" width="46" height="9" rx="4.5" fill="#7867f2" opacity="0.74"/>
    <circle cx="48" cy="190" r="10" fill="#f4a261"/>
    <rect x="66" y="182" width="39" height="9" rx="4.5" fill="#f4a261" opacity="0.7"/>
    <rect x="144" y="20" width="251" height="74" rx="18" fill="#4aa8ff" opacity="0.12"/>
    <circle cx="170" cy="57" r="12" fill="#4aa8ff"/>
    <rect x="192" y="43" width="150" height="10" rx="5" fill="#4aa8ff" opacity="0.58"/>
    <rect x="192" y="62" width="98" height="8" rx="4" fill="#98a2b3" opacity="0.5"/>
    <rect x="144" y="112" width="190" height="66" rx="18" fill="#43d8b0" opacity="0.13"/>
    <circle cx="170" cy="145" r="12" fill="#43d8b0"/>
    <rect x="192" y="132" width="112" height="10" rx="5" fill="#43d8b0" opacity="0.62"/>
    <rect x="192" y="151" width="78" height="8" rx="4" fill="#98a2b3" opacity="0.5"/>
    <rect x="144" y="196" width="251" height="59" rx="18" fill="#7867f2" opacity="0.12"/>
    <circle cx="170" cy="225" r="12" fill="#7867f2"/>
    <rect x="192" y="212" width="134" height="10" rx="5" fill="#7867f2" opacity="0.6"/>
    <rect x="192" y="231" width="92" height="8" rx="4" fill="#98a2b3" opacity="0.5"/>
    <circle cx="370" cy="145" r="25" fill="url(#accent)"/>
    <path d="M359 145h22M370 134v22" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  </g>`
  });
}

function gridLines(x, y, width, height, count = 4) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const yy = y + (height / count) * index;
    return `<line class="grid" x1="${x}" y1="${yy.toFixed(1)}" x2="${x + width}" y2="${yy.toFixed(1)}" stroke-width="1"/>`;
  }).join("\n");
}

function renderLineChart(data, { x, y, width, height, accent = "#43d8b0", labelEvery = 5 }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((item, index) => {
    const px = x + index * step;
    const py = y + height - (item.value / max) * height;
    return { ...item, x: px, y: py };
  });
  const pointString = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${x},${y + height} ${pointString} ${x + width},${y + height}`;
  const labels = points.map((point, index) => {
    if (index !== 0 && index !== points.length - 1 && index % labelEvery !== 0) return "";
    return `<text class="small faint" x="${point.x.toFixed(1)}" y="${y + height + 20}" text-anchor="middle">${escapeXml(point.label)}</text>`;
  }).join("\n");
  const dots = points.filter((point) => point.value > 0).map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.2" fill="${accent}"/>`).join("\n");
  return `${gridLines(x, y, width, height)}
<polygon points="${area}" fill="${accent}" opacity="0.13"/>
<polyline points="${pointString}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
${dots}
${labels}`;
}

function renderBarChart(data, { x, y, width, height, accent = "#4aa8ff", gap = 6, labelEvery = 1 }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  const slot = width / data.length;
  const barWidth = Math.max(4, slot - gap);
  return data.map((item, index) => {
    const barHeight = item.value === 0 ? 2 : Math.max(5, (item.value / max) * height);
    const px = x + index * slot + (slot - barWidth) / 2;
    const py = y + height - barHeight;
    const lastWouldCrowdPrevious = index === data.length - 1 && index > 0 && (index - 1) % labelEvery === 0;
    const showLabel = index % labelEvery === 0 || (index === data.length - 1 && !lastWouldCrowdPrevious);
    const label = showLabel
      ? `<text class="small faint" x="${(px + barWidth / 2).toFixed(1)}" y="${y + height + 19}" text-anchor="middle">${escapeXml(item.label)}</text>`
      : "";
    return `<g><rect class="track" x="${px.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${height}" rx="${Math.min(7, barWidth / 2).toFixed(1)}" opacity="0.44"/><rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="${Math.min(7, barWidth / 2).toFixed(1)}" fill="${accent}"/><title>${escapeXml(item.accessibleLabel ?? item.label)}: ${item.value}</title>${label}</g>`;
  }).join("\n");
}

function updatedLabel(locale, generatedAt) {
  const formatter = new Intl.DateTimeFormat(
    { en: "en-GB", fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-PT" }[locale],
    { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }
  );
  return formatter.format(new Date(generatedAt));
}

function kpiMarkup(metrics, copy, locale, mobile) {
  const items = [
    [metrics.commits, copy.kpiCommits, "#43d8b0"],
    [metrics.mergedPullRequests, copy.kpiPullRequests, "#4aa8ff"],
    [metrics.activeDays, copy.kpiActiveDays, "#7867f2"],
    [metrics.humanCommitAuthors, copy.kpiAuthors, "#f4a261"]
  ];
  if (mobile) {
    return items.map(([value, label, color], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 22 + column * 194;
      const y = 82 + row * 96;
      return `<g><rect class="panel" x="${x}" y="${y}" width="184" height="82" rx="16"/><rect x="${x}" y="${y}" width="5" height="82" rx="2.5" fill="${color}"/><text class="kpi ink" x="${x + 18}" y="${y + 39}" style="font-size:28px">${escapeXml(formatNumber(value, locale))}</text><text class="small muted" x="${x + 18}" y="${y + 62}">${escapeXml(label)}</text></g>`;
    }).join("\n");
  }
  return items.map(([value, label, color], index) => {
    const x = 32 + index * 286;
    return `<g><rect class="panel" x="${x}" y="82" width="270" height="94" rx="18"/><rect x="${x}" y="82" width="6" height="94" rx="3" fill="${color}"/><text class="kpi ink" x="${x + 22}" y="125">${escapeXml(formatNumber(value, locale))}</text><text class="label muted" x="${x + 22}" y="151">${escapeXml(label)}</text></g>`;
  }).join("\n");
}

export function renderActivitySvg(metrics, locale, mobile = false) {
  const copy = LOCALES[locale];
  const monthlyCommits = metrics.monthlyCommitsByLocale[locale];
  const monthlyPullRequests = metrics.monthlyPullRequestsByLocale[locale];
  if (mobile) {
    const width = 420;
    const height = 1110;
    return svgShell({
      width,
      height,
      title: copy.pulseTitle,
      description: copy.pulseSubtitle,
      body: `  <rect x="0" y="0" width="420" height="8" rx="4" fill="url(#accent)"/>
  <text class="title ink" x="22" y="43" style="font-size:23px">${escapeXml(copy.pulseTitle)}</text>
  <text class="subtitle muted" x="22" y="65" style="font-size:12px">${escapeXml(copy.pulseSubtitle)}</text>
${kpiMarkup(metrics, copy, locale, true)}
  <g><rect class="panel" x="22" y="286" width="376" height="244" rx="18"/><text class="label ink" x="40" y="319">${escapeXml(copy.dailyTitle)}</text><text class="small muted" x="40" y="338">${escapeXml(copy.dailySubtitle)}</text>${renderLineChart(metrics.daily, { x: 40, y: 365, width: 340, height: 125, labelEvery: 6 })}</g>
  <g><rect class="panel" x="22" y="548" width="376" height="214" rx="18"/><text class="label ink" x="40" y="581">${escapeXml(copy.weeklyTitle)}</text><text class="small muted" x="40" y="600">${escapeXml(copy.weeklySubtitle)}</text>${renderBarChart(metrics.weekly, { x: 40, y: 627, width: 340, height: 92, accent: "#4aa8ff", gap: 9, labelEvery: 2 })}</g>
  <g><rect class="panel" x="22" y="780" width="376" height="142" rx="18"/><text class="label ink" x="40" y="813">${escapeXml(copy.monthlyCommitsTitle)}</text>${renderBarChart(monthlyCommits, { x: 40, y: 836, width: 340, height: 52, accent: "#43d8b0", gap: 8, labelEvery: 2 })}</g>
  <g><rect class="panel" x="22" y="940" width="376" height="142" rx="18"/><text class="label ink" x="40" y="973">${escapeXml(copy.monthlyPullRequestsTitle)}</text>${renderBarChart(monthlyPullRequests, { x: 40, y: 996, width: 340, height: 52, accent: "#7867f2", gap: 8, labelEvery: 2 })}</g>
  <text class="small faint" x="22" y="1098">${escapeXml(copy.updated)} ${escapeXml(updatedLabel(locale, metrics.generatedAt))}</text>`
    });
  }

  const width = 1200;
  const height = 690;
  return svgShell({
    width,
    height,
    title: copy.pulseTitle,
    description: copy.pulseSubtitle,
    body: `  <rect x="0" y="0" width="1200" height="10" rx="5" fill="url(#accent)"/>
  <text class="title ink" x="32" y="48">${escapeXml(copy.pulseTitle)}</text>
  <text class="subtitle muted" x="32" y="70">${escapeXml(copy.pulseSubtitle)}</text>
${kpiMarkup(metrics, copy, locale, false)}
  <g><rect class="panel" x="32" y="204" width="740" height="274" rx="20"/><text class="label ink" x="54" y="239">${escapeXml(copy.dailyTitle)}</text><text class="small muted" x="54" y="259">${escapeXml(copy.dailySubtitle)}</text>${renderLineChart(metrics.daily, { x: 54, y: 286, width: 696, height: 140, labelEvery: 5 })}</g>
  <g><rect class="panel" x="790" y="204" width="378" height="274" rx="20"/><text class="label ink" x="812" y="239">${escapeXml(copy.weeklyTitle)}</text><text class="small muted" x="812" y="259">${escapeXml(copy.weeklySubtitle)}</text>${renderBarChart(metrics.weekly, { x: 812, y: 286, width: 334, height: 140, accent: "#4aa8ff", gap: 10, labelEvery: 2 })}</g>
  <g><rect class="panel" x="32" y="500" width="558" height="150" rx="20"/><text class="label ink" x="54" y="535">${escapeXml(copy.monthlyCommitsTitle)}</text>${renderBarChart(monthlyCommits, { x: 54, y: 558, width: 514, height: 52, accent: "#43d8b0", gap: 10, labelEvery: 1 })}</g>
  <g><rect class="panel" x="610" y="500" width="558" height="150" rx="20"/><text class="label ink" x="632" y="535">${escapeXml(copy.monthlyPullRequestsTitle)}</text>${renderBarChart(monthlyPullRequests, { x: 632, y: 558, width: 514, height: 52, accent: "#7867f2", gap: 10, labelEvery: 1 })}</g>
  <text class="small faint" x="32" y="674">${escapeXml(copy.updated)} ${escapeXml(updatedLabel(locale, metrics.generatedAt))}</text>
  <text class="small faint" x="1168" y="674" text-anchor="end">${escapeXml(copy.period)}</text>`
  });
}

function authorRows(entries, { x, y, width, rowHeight, maxRows, accent, locale, otherLabel, noActivity }) {
  const visible = topAuthors(entries, maxRows, otherLabel);
  if (visible.length === 0) {
    return `<text class="body muted" x="${x}" y="${y + 28}">${escapeXml(noActivity)}</text>`;
  }
  const max = Math.max(...visible.map((entry) => entry.count), 1);
  return visible.map((entry, index) => {
    const yy = y + index * rowHeight;
    const barWidth = Math.max(5, (entry.count / max) * width);
    return `<g><text class="body ink" x="${x}" y="${yy + 14}">${escapeXml(entry.label)}</text><text class="label muted" x="${x + width}" y="${yy + 14}" text-anchor="end">${escapeXml(formatNumber(entry.count, locale))}</text><rect class="track" x="${x}" y="${yy + 24}" width="${width}" height="10" rx="5"/><rect x="${x}" y="${yy + 24}" width="${barWidth.toFixed(1)}" height="10" rx="5" fill="${accent}"/></g>`;
  }).join("\n");
}

export function renderContributorsSvg(metrics, locale, mobile = false) {
  const copy = LOCALES[locale];
  if (mobile) {
    return svgShell({
      width: 420,
      height: 805,
      title: copy.contributorsTitle,
      description: copy.contributorsSubtitle,
      body: `  <rect x="0" y="0" width="420" height="8" rx="4" fill="url(#accent)"/>
  <text class="title ink" x="22" y="43" style="font-size:22px">${escapeXml(copy.contributorsTitle)}</text>
  <text class="subtitle muted" x="22" y="65" style="font-size:11px">${escapeXml(copy.contributorsSubtitle)}</text>
  <g><rect class="panel" x="22" y="88" width="376" height="306" rx="18"/><text class="label ink" x="40" y="121">${escapeXml(copy.commitAuthors)}</text>${authorRows(metrics.commitAuthors, { x: 40, y: 145, width: 340, rowHeight: 44, maxRows: 5, accent: "#43d8b0", locale, otherLabel: copy.otherAuthors, noActivity: copy.noActivity })}</g>
  <g><rect class="panel" x="22" y="412" width="376" height="306" rx="18"/><text class="label ink" x="40" y="445">${escapeXml(copy.pullRequestAuthors)}</text>${authorRows(metrics.pullRequestAuthors, { x: 40, y: 469, width: 340, rowHeight: 44, maxRows: 5, accent: "#7867f2", locale, otherLabel: copy.otherAuthors, noActivity: copy.noActivity })}</g>
  <g><rect class="panel-strong" x="22" y="736" width="376" height="48" rx="16"/><text class="small ink" x="40" y="757">${escapeXml(copy.automation)}: ${escapeXml(formatNumber(metrics.automationCommits, locale))} ${escapeXml(copy.commitsWord)} · ${escapeXml(formatNumber(metrics.automationPullRequests, locale))} ${escapeXml(copy.prsWord)}</text><text class="small muted" x="40" y="775">${escapeXml(copy.botsNote)}</text></g>
  <text class="small faint" x="22" y="799">${escapeXml(copy.updated)} ${escapeXml(updatedLabel(locale, metrics.generatedAt))}</text>`
    });
  }

  return svgShell({
    width: 1200,
    height: 450,
    title: copy.contributorsTitle,
    description: copy.contributorsSubtitle,
    body: `  <rect x="0" y="0" width="1200" height="10" rx="5" fill="url(#accent)"/>
  <text class="title ink" x="32" y="48">${escapeXml(copy.contributorsTitle)}</text>
  <text class="subtitle muted" x="32" y="70">${escapeXml(copy.contributorsSubtitle)}</text>
  <g><rect class="panel" x="32" y="96" width="558" height="282" rx="20"/><text class="label ink" x="54" y="132">${escapeXml(copy.commitAuthors)}</text>${authorRows(metrics.commitAuthors, { x: 54, y: 157, width: 514, rowHeight: 42, maxRows: 5, accent: "#43d8b0", locale, otherLabel: copy.otherAuthors, noActivity: copy.noActivity })}</g>
  <g><rect class="panel" x="610" y="96" width="558" height="282" rx="20"/><text class="label ink" x="632" y="132">${escapeXml(copy.pullRequestAuthors)}</text>${authorRows(metrics.pullRequestAuthors, { x: 632, y: 157, width: 514, rowHeight: 42, maxRows: 5, accent: "#7867f2", locale, otherLabel: copy.otherAuthors, noActivity: copy.noActivity })}</g>
  <g><rect class="panel-strong" x="32" y="396" width="1136" height="34" rx="14"/><text class="small ink" x="50" y="418">${escapeXml(copy.automation)}: ${escapeXml(formatNumber(metrics.automationCommits, locale))} ${escapeXml(copy.commitsWord)} · ${escapeXml(formatNumber(metrics.automationPullRequests, locale))} ${escapeXml(copy.prsWord)} — ${escapeXml(copy.botsNote)}</text></g>
  <text class="small faint" x="32" y="443">${escapeXml(copy.updated)} ${escapeXml(updatedLabel(locale, metrics.generatedAt))}</text>
  <text class="small faint" x="1168" y="443" text-anchor="end">${escapeXml(copy.period)}</text>`
  });
}

async function githubRequest(url, token) {
  const target = new URL(url, API_ROOT);
  if (target.origin !== API_ROOT) throw new Error("Refusing a non-GitHub API request");
  const response = await fetch(target, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "towk-readme-metrics",
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

export async function fetchRepositoryMetrics({ repository, branch, token, now = new Date() }) {
  if (!token) throw new Error("GITHUB_TOKEN is required for live metrics");
  const { owner, name } = assertRepository(repository);
  const safeBranch = assertBranch(branch);
  const snapshot = new Date(now);
  if (Number.isNaN(snapshot.getTime())) throw new Error("Invalid snapshot date");
  const from = addUtcDays(utcDay(snapshot), -364);
  const commitsUrl = `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(safeBranch)}&since=${encodeURIComponent(from.toISOString())}&until=${encodeURIComponent(snapshot.toISOString())}&per_page=${PAGE_SIZE}`;
  const pullsUrl = `/repos/${owner}/${name}/pulls?state=closed&base=${encodeURIComponent(safeBranch)}&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
  const [commits, closedPullRequests] = await Promise.all([
    fetchPages(commitsUrl, token, MAX_COMMIT_PAGES),
    fetchPages(pullsUrl, token, MAX_PULL_REQUEST_PAGES)
  ]);
  const pullRequests = closedPullRequests.filter((pullRequest) => {
    const mergedAt = dateFromPullRequest(pullRequest);
    return mergedAt && mergedAt >= from && mergedAt <= snapshot;
  });
  return { commits, pullRequests, from: from.toISOString(), to: snapshot.toISOString() };
}

function demoData(now = new Date("2026-07-23T19:17:00Z")) {
  const commits = [];
  const authors = [
    { login: "Yo-DDV", type: "User" },
    { login: "alice", type: "User" },
    { login: "bob", type: "User" },
    { login: "dependabot[bot]", type: "Bot" }
  ];
  for (let offset = 0; offset < 365; offset += 1) {
    const date = addUtcDays(utcDay(now), -offset);
    const season = 3 + Math.round(3 * Math.sin(offset / 24));
    const count = offset % 7 === 5 ? 0 : Math.max(0, season + ((offset * 7) % 5) - 1);
    for (let index = 0; index < count; index += 1) {
      const author = authors[(offset + index * 3) % authors.length];
      commits.push({
        author,
        commit: {
          author: { name: author.login, date: date.toISOString() },
          committer: { name: author.login, date: date.toISOString() }
        }
      });
    }
  }
  const pullRequests = [];
  for (let offset = 0; offset < 330; offset += 5) {
    const date = addUtcDays(utcDay(now), -offset);
    const author = authors[(offset / 5) % 3];
    pullRequests.push({ user: author, merged_at: date.toISOString() });
  }
  return { commits, pullRequests };
}

export async function writeAssets({ outputDir, metrics, repository, branch, sourceCommit }) {
  await mkdir(outputDir, { recursive: true });
  for (const locale of Object.keys(LOCALES)) {
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
    version: metrics.version,
    repository,
    branch,
    sourceCommit: sourceCommit || null,
    generatedAt: metrics.generatedAt,
    window: "trailing-365-days",
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
  await writeFile(path.join(outputDir, "README.md"), `# Generated Towk README metrics\n\nThis branch is generated by \`.github/workflows/refresh-readme-metrics.yml\`.\n\n- Source repository: \`${repository}\`\n- Source branch: \`${branch}\`\n- Source commit: \`${sourceCommit || "unknown"}\`\n- Generated: \`${metrics.generatedAt}\`\n- Window: trailing 365 days\n\nDo not edit generated SVG or JSON files manually.\n`, "utf8");
}

function parseArguments(argv) {
  const options = { demo: false, outputDir: process.env.TOWK_METRICS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--demo") options.demo = true;
    else if (argument === "--output") {
      index += 1;
      if (!argv[index]) throw new Error("--output requires a path");
      options.outputDir = path.resolve(argv[index]);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function generate({ demo = false, outputDir = DEFAULT_OUTPUT_DIR, now = new Date() } = {}) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.TOWK_METRICS_SOURCE_BRANCH || DEFAULT_BRANCH;
  assertRepository(repository);
  assertBranch(branch);
  const source = demo
    ? { ...demoData(now), from: addUtcDays(utcDay(now), -364).toISOString(), to: now.toISOString() }
    : await fetchRepositoryMetrics({
      repository,
      branch,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
      now
    });
  const metrics = buildMetrics(source.commits, source.pullRequests, now);
  await writeAssets({
    outputDir,
    metrics,
    repository,
    branch,
    sourceCommit: process.env.GITHUB_SHA
  });
  return { outputDir, repository, branch, ...source, metrics };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  generate(options).then((result) => {
    process.stdout.write(`Generated localized README visuals in ${result.outputDir} for ${result.repository}@${result.branch}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
