#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_PUBLIC_FILE_BYTES = 2 * 1024 * 1024;

const forbiddenPatterns = [
  ['inherited product binary label', /chatto[^a-z0-9]{1,3}binary/gim],
  ['inherited CLI invocation', /(^|[\s`'"])chatto\s+(?:run|init|backup|restore|keys|operator|exporter|version)\b/gim],
  ['inherited configuration filename', /\bchatto\.toml\b/gim],
  ['inherited executable path', /(^|[\s`'"])\/chatto(?=$|[\s`'"])/gim],
  ['disabled Discussions link', /github\.com\/Yo-DDV\/Towk\/discussions\b/gim],
  ['obsolete stable-release claim', /does not currently publish stable binary releases/gim],
  ['obsolete package availability claim', /repository's Packages page once available/gim],
  ['obsolete pilot claim', /\bpilot deployment\b/gim],
  ['upstream issue tracker link', /github\.com\/chattocorp\/chatto\/issues/gim],
  ['product-doc upstream relationship section', /^## Relationship to Chatt[o]$/gim],
  ['upstream support disclaimer outside legal docs', /\bChattoCorp(?: GmbH)?\b/gim],
];

export const publicRoots = [
  'README.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
  'DESIGN.md',
  'LICENSING.md',
  'PROVENANCE.md',
  'SOURCE.md',
  'UPSTREAM.md',
  'docker/README.md',
  'examples/dockercompose/README.md',
  'examples/k8s/README.md',
  'docs/ARCHITECTURE.md',
  'docs/GLOSSARY.md',
  'docs/RELEASING.md',
  'docs/governance',
  'docs/fdr',
  'apps/docs-website/src/content/docs',
];

function isCurrentPublicDocument(relativePath) {
  if (!/\.(?:md|mdx)$/.test(relativePath)) return false;
  return ![
    '/reference/connectrpc-api/',
    '/release-notes/',
    '/releases/',
  ].some((segment) => `/${relativePath}`.includes(segment));
}

async function collectFiles(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const fileStat = await stat(absolutePath);
  if (fileStat.isFile()) return isCurrentPublicDocument(relativePath) ? [relativePath] : [];
  if (!fileStat.isDirectory()) return [];

  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    files.push(...await collectFiles(root, path.join(relativePath, entry.name)));
  }
  return files;
}

export function findPublicSurfaceViolations(relativePath, contents) {
  const violations = [];
  const legalAttributionFiles = new Set(['README.md', 'LICENSING.md', 'PROVENANCE.md', 'SOURCE.md', 'UPSTREAM.md']);
  for (const [name, pattern] of forbiddenPatterns) {
    if (name === 'upstream issue tracker link' && /^docs\/adr\//.test(relativePath)) continue;
    if (name === 'upstream support disclaimer outside legal docs' && legalAttributionFiles.has(relativePath)) continue;
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const line = contents.slice(0, match.index).split('\n').length;
      violations.push(`${relativePath}:${line}: ${name}`);
    }
  }
  return violations;
}

export async function checkPublicSurface(root = process.cwd()) {
  const files = (await Promise.all(publicRoots.map((entry) => collectFiles(root, entry)))).flat().sort();
  const violations = [];

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const fileStat = await stat(absolutePath);
    if (fileStat.size > MAX_PUBLIC_FILE_BYTES) {
      violations.push(`${relativePath}: exceeds ${MAX_PUBLIC_FILE_BYTES} bytes`);
      continue;
    }
    violations.push(...findPublicSurfaceViolations(relativePath, await readFile(absolutePath, 'utf8')));
  }

  const required = [
    ['README.md', 'github.com/chattocorp/chatto'],
    ['NOTICE', 'ChattoCorp GmbH'],
    ['LICENSING.md', 'independent project based on Chatto'],
    ['.goreleaser.yml', 'binary: towk'],
    ['.goreleaser.yml', 'ids: [towk-cli]'],
    ['.goreleaser.yml', 'LICENSES/Apache-2.0.txt'],
    ['.goreleaser.yml', 'disable: true'],
    ['docker/docker-entrypoint.sh', '/towk'],
    ['docker/Dockerfile.goreleaser', 'TOWK_CONFIG_DIR=/config'],
    ['docker/Dockerfile.towk', 'TOWK_CONFIG_DIR=/config'],
    ['docker/Dockerfile.towk', 'COPY SOURCE.md /usr/share/doc/towk/SOURCE.md'],
    ['tools/verify-release-archives.sh', 'binary=towk.exe'],
    ['tools/verify-runtime-image.sh', 'Verified Towk runtime identity'],
    ['.github/workflows/release.yml', 'release_tag:'],
    ['.github/workflows/release.yml', 'Refusing to replace existing release asset'],
    ['.github/workflows/build-image.yml', 'Refusing to replace existing image tag'],
  ];
  for (const [relativePath, expected] of required) {
    const contents = await readFile(path.join(root, relativePath), 'utf8');
    if (!contents.includes(expected)) {
      violations.push(`${relativePath}: missing required public-surface marker ${JSON.stringify(expected)}`);
    }
  }

  const forbiddenDistributionMarkers = [
    ['.goreleaser.yml', 'chatto'],
    ['docker/Dockerfile.goreleaser', 'chatto'],
    ['docker/Dockerfile.towk', 'chatto'],
    ['docker/docker-entrypoint.sh', 'chatto'],
    ['apps/docs-website/src/custom.css', '--chatto-'],
    ['apps/docs-website/src/components/diagrams/Box.astro', "'chatto'"],
    ['apps/docs-website/src/components/diagrams/styles.ts', 'box-chatto'],
    ['apps/docs-website/src/components/diagrams/BinaryDiagram.astro', 'chatto'],
    ['apps/docs-website/src/components/diagrams/DockerComposeDiagram.astro', 'chatto'],
    ['apps/docs-website/src/components/diagrams/HighAvailabilityDiagram.astro', 'chatto'],
    ['apps/docs-website/src/components/diagrams/HorizontalScalingDiagram.astro', 'chatto'],
  ];
  for (const [relativePath, forbidden] of forbiddenDistributionMarkers) {
    const contents = await readFile(path.join(root, relativePath), 'utf8');
    if (contents.toLowerCase().includes(forbidden)) {
      violations.push(`${relativePath}: contains forbidden distribution marker ${JSON.stringify(forbidden)}`);
    }
  }
  return { filesChecked: files.length, violations };
}

async function main() {
  const result = await checkPublicSurface();
  if (result.violations.length > 0) {
    process.stderr.write(`${result.violations.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Public surface check passed (${result.filesChecked} documents).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
