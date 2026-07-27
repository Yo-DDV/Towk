#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const FRONTEND_ROOT = 'apps/frontend/src';
const BACKEND_ROOT = 'cli/internal';
const MESSAGES_ROOT = 'apps/frontend/messages';
const SETTINGS_FILE = 'apps/frontend/project.inlang/settings.json';

const USER_FACING_ATTRIBUTES = [
  'alt',
  'aria-label',
  'caption',
  'description',
  'empty-body',
  'empty-label',
  'empty-text',
  'empty-title',
  'help',
  'helper-text',
  'label',
  'placeholder',
  'subtitle',
  'title',
  'tooltip'
];

const USER_FACING_PROPERTIES = [
  'alt',
  'ariaLabel',
  'body',
  'caption',
  'description',
  'emptyBody',
  'emptyLabel',
  'emptyText',
  'emptyTitle',
  'help',
  'helperText',
  'label',
  'placeholder',
  'subtitle',
  'summary',
  'title',
  'tooltip'
];

const APPROVED_IDENTICAL_VALUES = new Set([
  'AV1',
  'CSS',
  'Esc',
  'GIF',
  'HEIC',
  'HTML',
  'JPEG',
  'LiveKit',
  'Markdown',
  'NATS',
  'OK',
  'Opus',
  'PNG',
  'S3',
  'Towk',
  'URL',
  'VP8',
  'VP9',
  'WebP',
  'WebRTC',
  'YouTube',
  'WebSocket',
  'ms',
  'v'
]);

const APPROVED_IDENTICAL_VALUES_BY_LOCALE = new Map([
  [
    'de',
    new Set([
      'Audio',
      'Avatar',
      'Banner',
      'Beep Boop',
      'Bytes',
      'Chaos',
      'Codec',
      'Consumer',
      'Deutsch',
      'Ding',
      'Echo',
      'English',
      'Español',
      'Event',
      'Events',
      'Français',
      'Glitch',
      'In',
      'Jitter',
      'La Cucaracha',
      'Live',
      'Login',
      'Logo',
      'Moderation',
      'Moderator',
      'Name',
      'Normal',
      'Offline',
      'Online',
      'Payload',
      'Português',
      'Pull',
      'Push',
      'Seq',
      'Server',
      'Single Sign-On',
      'Status',
      'Stream',
      'Streams',
      'System',
      'Thread',
      'Transport',
      'Version',
      'Video',
      'in'
    ])
  ],
  [
    'fr',
    new Set([
      '30 minutes',
      'Audio',
      'Avatar',
      'Chaos',
      'Codec',
      'Description',
      'Ding',
      'Español',
      'Excellent',
      'Français',
      'Glitch',
      'Image',
      'La Cucaracha',
      'Logo',
      'Message',
      'Messages',
      'Microphone',
      'Mode',
      'Musical',
      'Normal',
      'Notifications',
      'Permission',
      'Permissions',
      'Projection',
      'Projections',
      'Português',
      'Pull',
      'Push',
      'Retransmissions',
      'Robots',
      'Simple',
      'Suggestions',
      'Transport',
      'Version',
      'Volume',
      'messages'
    ])
  ],
  [
    'es',
    new Set([
      'Actor',
      'Audio',
      'Avatar',
      'Deutsch',
      'Español',
      'Français',
      'General',
      'La Cucaracha',
      'Logo',
      'Musical',
      'No',
      'Normal',
      'Português',
      'Pull',
      'Push',
      'Roles',
      'Robots',
      'Simple',
      'Universal',
      'Video'
    ])
  ],
  [
    'pt',
    new Set([
      'Bytes',
      'Codec',
      'Deutsch',
      'Ding',
      'Español',
      'Français',
      'Jitter',
      'La Cucaracha',
      'Musical',
      'Normal',
      'Português',
      'Pull',
      'Push',
      'Status',
      'Stream',
      'Streams',
      'Universal',
      'Volume'
    ])
  ]
]);

const APPROVED_IDENTICAL_KEY_PATTERNS = [
  /(?:^|\.)brand(?:\.|$)/,
  /(?:^|\.)(?:format|codec|protocol|provider|product|technology)(?:\.|$)/,
  /(?:^|\.)(?:language|locale)_[a-z]{2}(?:\.|$)/,
  /(?:^|\.)emoji(?:\.|$)/,
  /(?:^|\.)url_placeholder$/,
  /(?:^|\.)version$/,
  /(?:^|\.)settings\.preferences\.language\.(?:english|german|french|spanish|portuguese)$/,
  /(?:^|\.)settings\.notifications\.sound\.name\./,
  /(?:^|\.)jitter_value$/,
  /(?:^|\.)server_role_many$/,
  /(?:^|\.)room_placeholder_compact$/,
  /(?:^|\.)room\.sidebar\.(?:online|offline)$/,
  /(?:^|\.)room\.thread\.title$/,
  /(?:^|\.)room_list\.notifications$/,
  /(?:^|\.)voice\.push\.channel_body$/
];

const SUSPICIOUS_TRANSLATIONS = [
  ['de', /\bDeaktivieren Sie\b/i, 'formal register in an otherwise informal interface'],
  ['es', /\batrapad(?:o|os|a|as)\b/i, 'literal translation of “caught”'],
  ['es', /\bsiguió los hilos\b/i, 'incorrect tense/agreement'],
  ['es', /\ba los que le interesan\b/i, 'formal register and incorrect room agreement'],
  [
    'es',
    /\b(?:remarcación|rebajas|gota de dubstep|florecimiento del arpa)\b/i,
    'known literal mistranslation'
  ],
  ['pt', /\bapanhad(?:o|os|a|as)\b/i, 'literal translation of “caught”'],
  ['pt', /\bthreads?\b/i, 'untranslated English term'],
  [
    'pt',
    /\b(?:ficheiros?|ecrã|respetiv[ao]|iniciar sessão|partilhar|multimédia|workers?)\b/i,
    'European Portuguese or untranslated term in the pt-BR catalog'
  ],
  ['pt', /\bA carregar\b/i, 'European Portuguese progressive form in the pt-BR catalog'],
  [
    'pt',
    /\b(?:Tininho|Trituração|remarcação|LaserZap|Celesta Sonho)\b/i,
    'known literal mistranslation'
  ]
];

function lineNumber(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripPlaceholders(value) {
  return value
    .replace(/\{[^{}]+\}/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g, '');
}

function hasNaturalLanguage(value) {
  const candidate = stripPlaceholders(value)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\w.-]+@[\w.-]+/g, '')
    .trim();
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(candidate);
}

function isTechnicalToken(value) {
  const normalized = normalizeWhitespace(value);
  if (APPROVED_IDENTICAL_VALUES.has(normalized)) return true;
  if (/^(?:[A-Z0-9][A-Z0-9+_.:/-]*|#[A-Za-z0-9_-]+)$/u.test(normalized)) return true;
  return false;
}

function isIgnoredLine(line) {
  return line.includes('i18n-audit-ignore');
}

function addViolation(violations, relativePath, contents, index, category, value) {
  const line = lineNumber(contents, index);
  const sourceLine = contents.split('\n')[line - 1] ?? '';
  if (isIgnoredLine(sourceLine)) return;
  violations.push({
    path: relativePath,
    line,
    category,
    value: normalizeWhitespace(value)
  });
}

export function flattenCatalog(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unsupported catalog value at ${prefix || '<root>'}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema') continue;
    flattenCatalog(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function approvedIdenticalTranslation(locale, key, value) {
  const normalized = normalizeWhitespace(value);
  if (!hasNaturalLanguage(normalized)) return true;
  if (isTechnicalToken(normalized)) return true;
  if (APPROVED_IDENTICAL_VALUES_BY_LOCALE.get(locale)?.has(normalized)) return true;
  return APPROVED_IDENTICAL_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function findCatalogSemanticViolations(locale, baseMessages, localizedMessages) {
  const violations = [];
  for (const [key, localizedValue] of localizedMessages) {
    const baseValue = baseMessages.get(key);
    if (typeof baseValue !== 'string') continue;
    const baseNormalized = normalizeWhitespace(baseValue);
    const localizedNormalized = normalizeWhitespace(localizedValue);
    if (
      locale !== 'en' &&
      baseNormalized === localizedNormalized &&
      !approvedIdenticalTranslation(locale, key, localizedNormalized)
    ) {
      violations.push({
        key,
        category: 'translation-identical-to-english',
        value: localizedNormalized
      });
    }
    for (const [targetLocale, pattern, reason] of SUSPICIOUS_TRANSLATIONS) {
      if (locale === targetLocale && pattern.test(localizedNormalized)) {
        violations.push({
          key,
          category: `suspicious-translation (${reason})`,
          value: localizedNormalized
        });
      }
    }
  }
  return violations;
}

function maskPreservingLines(value) {
  return value.replace(/[^\n]/g, ' ');
}

function stripJavaScriptComments(contents) {
  let output = '';
  let index = 0;
  let quote = null;
  let escaped = false;
  while (index < contents.length) {
    const character = contents[index];
    const next = contents[index + 1];
    if (quote) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      index++;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      output += character;
      index++;
      continue;
    }
    if (character === '/' && next === '/') {
      const end = contents.indexOf('\n', index);
      if (end === -1) {
        output += maskPreservingLines(contents.slice(index));
        break;
      }
      output += maskPreservingLines(contents.slice(index, end));
      index = end;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = contents.indexOf('*/', index + 2);
      const finish = end === -1 ? contents.length : end + 2;
      output += maskPreservingLines(contents.slice(index, finish));
      index = finish;
      continue;
    }
    output += character;
    index++;
  }
  return output;
}

function stripSvelteExpressions(contents) {
  let output = '';
  let index = 0;
  while (index < contents.length) {
    if (contents[index] !== '{') {
      output += contents[index];
      index++;
      continue;
    }

    const start = index;
    let depth = 0;
    let quote = null;
    let escaped = false;
    while (index < contents.length) {
      const character = contents[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
      } else if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth++;
      } else if (character === '}') {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
      index++;
    }
    output += maskPreservingLines(contents.slice(start, index));
  }
  return output;
}

function stripSvelteBlocks(contents) {
  const withoutBlocks = contents
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => maskPreservingLines(match))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => maskPreservingLines(match))
    .replace(/<!--([\s\S]*?)-->/g, (match) =>
      match.includes('i18n-audit-ignore') ? match : maskPreservingLines(match)
    );
  return stripSvelteExpressions(withoutBlocks);
}

export function findSvelteVisibleLiterals(relativePath, contents) {
  const violations = [];
  const markup = stripSvelteBlocks(contents);
  const attributePattern = new RegExp(
    `\\b(?:${USER_FACING_ATTRIBUTES.join('|')})\\s*=\\s*(["'])([^"'{}]*[A-Za-zÀ-ÖØ-öø-ÿ][^"'{}]*)\\1`,
    'giu'
  );
  for (const match of markup.matchAll(attributePattern)) {
    const value = match[2];
    if (isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      markup,
      match.index ?? 0,
      'hard-coded user-facing attribute',
      value
    );
  }

  const textPattern = />([^<>{}]*[A-Za-zÀ-ÖØ-öø-ÿ][^<>{}]*)</gu;
  for (const match of markup.matchAll(textPattern)) {
    const value = normalizeWhitespace(match[1]);
    if (!value || !hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    if (/^(?:slot|svelte|component)$/i.test(value)) continue;
    addViolation(
      violations,
      relativePath,
      markup,
      match.index ?? 0,
      'hard-coded markup text',
      value
    );
  }
  return violations;
}

function unescapeSimpleString(value) {
  return value.replace(/\\([\\'"`nrt])/g, (_match, escaped) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    return escaped;
  });
}

export function findScriptVisibleLiterals(relativePath, contents) {
  const violations = [];
  const auditableContents = stripJavaScriptComments(contents);
  const propertyPattern = new RegExp(
    `\\b(?:${USER_FACING_PROPERTIES.join('|')})\\s*:\\s*(["'\\x60])([^\\n]*?)\\1`,
    'gu'
  );
  for (const match of auditableContents.matchAll(propertyPattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      auditableContents,
      match.index ?? 0,
      'hard-coded user-facing property',
      value
    );
  }

  const uiCallPattern =
    /\b(?:alert|confirm|prompt|showNotification|toast(?:\.[A-Za-z]+)?)\s*\(\s*(["'`])([^\n]*?)\1/gu;
  for (const match of auditableContents.matchAll(uiCallPattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      auditableContents,
      match.index ?? 0,
      'hard-coded user-facing call',
      value
    );
  }

  return violations;
}

export function findGoVisibleLiterals(relativePath, contents) {
  const violations = [];
  const fieldPattern =
    /\b(?:Subject|Title|Body|Summary|Description|Placeholder)\s*:\s*`([^`]*[A-Za-zÀ-ÖØ-öø-ÿ][^`]*)`|\b(?:Subject|Title|Body|Summary|Description|Placeholder)\s*:\s*"([^"\n]*[A-Za-zÀ-ÖØ-öø-ÿ][^"\n]*)"/gu;
  for (const match of contents.matchAll(fieldPattern)) {
    const value = match[1] ?? match[2] ?? '';
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      contents,
      match.index ?? 0,
      'hard-coded backend user-facing field',
      value
    );
  }

  const publicJSONPattern =
    /\b(?:gin\.H|map\[string\](?:any|string))\s*\{\s*"(?:error|message|error_description)"\s*:\s*(["`])([^\n]*?)\1/gu;
  for (const match of contents.matchAll(publicJSONPattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      contents,
      match.index ?? 0,
      'hard-coded public backend response',
      value
    );
  }

  const stringResponsePattern = /\bc\.String\s*\(\s*[^,\n]+,\s*(["`])([^\n]*?)\1/gu;
  for (const match of contents.matchAll(stringResponsePattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(
      violations,
      relativePath,
      contents,
      match.index ?? 0,
      'hard-coded public backend body',
      value
    );
  }

  const rawErrorPattern =
    /\bc\.(?:JSON|AbortWithStatusJSON|String)\s*\([^\n]*(?:err|error)\.Error\(\)/gu;
  for (const match of contents.matchAll(rawErrorPattern)) {
    addViolation(
      violations,
      relativePath,
      contents,
      match.index ?? 0,
      'raw backend error exposed to user',
      match[0]
    );
  }
  return violations;
}

async function collectFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  let rootStat;
  try {
    rootStat = await stat(absoluteRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (rootStat.isFile()) return [relativeRoot];
  if (!rootStat.isDirectory()) return [];

  const files = [];
  for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'paraglide', 'generated', 'pb'].includes(entry.name)) continue;
      files.push(...(await collectFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function isAuditedFrontendFile(relativePath) {
  if (!/\.(?:svelte|[cm]?[jt]s)$/u.test(relativePath)) return false;
  const fileName = path.basename(relativePath);
  return (
    !/(?:^|\/)(?:demos|e2e|storybook)(?:\/|$)/u.test(relativePath) &&
    !/\.(?:spec|test|stories|preview)\.(?:svelte|[cm]?[jt]s)$/u.test(relativePath) &&
    !/(?:Mock|StoryFrame|TestHarness)\.svelte$/u.test(fileName) &&
    !/\.d\.ts$/u.test(relativePath)
  );
}

function isAuditedBackendFile(relativePath) {
  if (!/\.(?:go|html|tmpl|txt)$/u.test(relativePath)) return false;
  return (
    !/_test\.go$/u.test(relativePath) &&
    !/(?:^|\/)testdata(?:\/|$)/u.test(relativePath) &&
    !/(?:^|\/)test_endpoints(?:_disabled)?\.go$/u.test(relativePath)
  );
}

async function readBounded(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const fileStat = await stat(absolutePath);
  if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${relativePath} exceeds ${MAX_SOURCE_FILE_BYTES} bytes`);
  }
  return readFile(absolutePath, 'utf8');
}

async function auditCatalogs(root) {
  const settings = JSON.parse(await readFile(path.join(root, SETTINGS_FILE), 'utf8'));
  const baseLocale = settings.baseLocale;
  const locales = settings.locales;
  const baseFiles = (await readdir(path.join(root, MESSAGES_ROOT, baseLocale)))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const violations = [];

  for (const file of baseFiles) {
    const baseMessages = flattenCatalog(
      JSON.parse(await readFile(path.join(root, MESSAGES_ROOT, baseLocale, file), 'utf8'))
    );
    for (const locale of locales) {
      if (locale === baseLocale) continue;
      const localizedPath = path.join(MESSAGES_ROOT, locale, file);
      const localizedMessages = flattenCatalog(
        JSON.parse(await readFile(path.join(root, localizedPath), 'utf8'))
      );
      for (const violation of findCatalogSemanticViolations(
        locale,
        baseMessages,
        localizedMessages
      )) {
        violations.push({
          path: localizedPath,
          line: 1,
          category: `${violation.category}: ${violation.key}`,
          value: violation.value
        });
      }
    }
  }
  return { filesChecked: baseFiles.length * locales.length, violations };
}

export async function auditUserVisibleCopy(root = process.cwd()) {
  const violations = [];
  let filesChecked = 0;

  const frontendFiles = (await collectFiles(root, FRONTEND_ROOT))
    .filter(isAuditedFrontendFile)
    .sort();
  for (const relativePath of frontendFiles) {
    const contents = await readBounded(root, relativePath);
    filesChecked++;
    if (relativePath.endsWith('.svelte')) {
      violations.push(...findSvelteVisibleLiterals(relativePath, contents));
    }
    if (/\.[cm]?[jt]s$/u.test(relativePath)) {
      violations.push(...findScriptVisibleLiterals(relativePath, contents));
    }
  }

  const backendFiles = (await collectFiles(root, BACKEND_ROOT)).filter(isAuditedBackendFile).sort();
  for (const relativePath of backendFiles) {
    const contents = await readBounded(root, relativePath);
    filesChecked++;
    if (relativePath.endsWith('.go')) {
      violations.push(...findGoVisibleLiterals(relativePath, contents));
    }
  }

  const catalogResult = await auditCatalogs(root);
  filesChecked += catalogResult.filesChecked;
  violations.push(...catalogResult.violations);

  return { filesChecked, violations };
}

function formatViolation(violation) {
  return `${violation.path}:${violation.line}: ${violation.category}: ${JSON.stringify(violation.value)}`;
}

async function main() {
  const result = await auditUserVisibleCopy();
  if (result.violations.length > 0) {
    process.stderr.write(`${result.violations.map(formatViolation).join('\n')}\n`);
    process.stderr.write(
      `Localization audit failed with ${result.violations.length} finding(s) across ${result.filesChecked} checked files.\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Localization audit passed (${result.filesChecked} files checked).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
