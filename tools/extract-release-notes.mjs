#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function extractReleaseNotes(markdown, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`invalid release tag: ${tag}`);
  }

  const version = tag.slice(1);
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }

  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return `${body}\n`;
}

async function main() {
  const [tag, changelogPath = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!tag) {
    throw new Error('usage: extract-release-notes.mjs <vMAJOR.MINOR.PATCH> [changelog]');
  }
  const markdown = await readFile(changelogPath, 'utf8');
  process.stdout.write(extractReleaseNotes(markdown, tag));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
