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
  'WebSocket'
]);

const APPROVED_IDENTICAL_KEY_PATTERNS = [
  /(?:^|\.)brand(?:\.|$)/,
  /(?:^|\.)(?:format|codec|protocol|provider|product|technology)(?:\.|$)/,
  /(?:^|\.)(?:language|locale)_[a-z]{2}(?:\.|$)/,
  /(?:^|\.)emoji(?:\.|$)/
];

const SUSPICIOUS_TRANSLATIONS = [
  ['es', /\batrapad(?:o|os|a|as)\b/i, 'literal translation of “caught”'],
  ['es', /\bsiguió los hilos\b/i, 'incorrect tense/agreement'],
  ['pt', /\bapanhad(?:o|os|a|as)\b/i, 'literal translation of “caught”'],
  ['pt', /\bthreads?\b/i, 'untranslated English term']
];

function lineNumber(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripPlaceholders(value) {
  return value.replace(/\{[^{}]+\}/g, '').replace(/<\/?[A-Za-z][^>]*>/g, '');
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

function approvedIdenticalTranslation(key, value) {
  const normalized = normalizeWhitespace(value);
  if (!hasNaturalLanguage(normalized)) return true;
  if (isTechnicalToken(normalized)) return true;
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
      !approvedIdenticalTranslation(key, localizedNormalized)
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

function stripSvelteBlocks(contents) {
  return contents
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => '\n'.repeat(match.split('\n').length - 1))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => '\n'.repeat(match.split('\n').length - 1))
    .replace(/<!--([\s\S]*?)-->/g, (match) =>
      match.includes('i18n-audit-ignore') ? match : '\n'.repeat(match.split('\n').length - 1)
    );
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
    addViolation(violations, relativePath, markup, match.index ?? 0, 'hard-coded user-facing attribute', value);
  }

  const textPattern = />([^<>{}]*[A-Za-zÀ-ÖØ-öø-ÿ][^<>{}]*)</gu;
  for (const match of markup.matchAll(textPattern)) {
    const value = normalizeWhitespace(match[1]);
    if (!value || isTechnicalToken(value)) continue;
    if (/^(?:slot|svelte|component)$/i.test(value)) continue;
    addViolation(violations, relativePath, markup, match.index ?? 0, 'hard-coded markup text', value);
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
  const propertyPattern = new RegExp(
    `\\b(?:${USER_FACING_PROPERTIES.join('|')})\\s*:\\s*(["'\\x60])([^\\n]*?)\\1`,
    'gu'
  );
  for (const match of contents.matchAll(propertyPattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(violations, relativePath, contents, match.index ?? 0, 'hard-coded user-facing property', value);
  }

  const uiCallPattern = /\b(?:alert|confirm|prompt|showNotification|toast(?:\.[A-Za-z]+)?)\s*\(\s*(["'`])([^\n]*?)\1/gu;
  for (const match of contents.matchAll(uiCallPattern)) {
    const value = unescapeSimpleString(match[2]);
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(violations, relativePath, contents, match.index ?? 0, 'hard-coded user-facing call', value);
  }

  return violations;
}

export function findGoVisibleLiterals(relativePath, contents) {
  const violations = [];
  const fieldPattern = /\b(?:Subject|Title|Body|Summary|Description|Placeholder)\s*:\s*`([^`]*[A-Za-zÀ-ÖØ-öø-ÿ][^`]*)`|\b(?:Subject|Title|Body|Summary|Description|Placeholder)\s*:\s*"([^"\n]*[A-Za-zÀ-ÖØ-öø-ÿ][^"\n]*)"/gu;
  for (const match of contents.matchAll(fieldPattern)) {
    const value = match[1] ?? match[2] ?? '';
    if (!hasNaturalLanguage(value) || isTechnicalToken(value)) continue;
    addViolation(violations, relativePath, contents, match.index ?? 0, 'hard-coded backend user-facing field', value);
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
  return !/(?:^|\/)(?:e2e|storybook)(?:\/|$)/u.test(relativePath) &&
    !/\.(?:spec|test|stories|preview)\.[cm]?[jt]s$/u.test(relativePath) &&
    !/\.d\.ts$/u.test(relativePath);
}

function isAuditedBackendFile(relativePath) {
  if (!/\.(?:go|html|tmpl|txt)$/u.test(relativePath)) return false;
  return !/_test\.go$/u.test(relativePath) && !/(?:^|\/)testdata(?:\/|$)/u.test(relativePath);
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
      for (const violation of findCatalogSemanticViolations(locale, baseMessages, localizedMessages)) {
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

  const frontendFiles = (await collectFiles(root, FRONTEND_ROOT)).filter(isAuditedFrontendFile).sort();
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
