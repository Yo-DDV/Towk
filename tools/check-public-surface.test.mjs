import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { checkPublicSurface, findPublicSurfaceViolations, publicRoots } from './check-public-surface.mjs';

test('rejects inherited product-facing commands and stale distribution claims', () => {
  const forbiddenUpstreamIssue = [
    'https://github.com',
    'chattocorp',
    'chatto',
    'issues/1377',
  ].join('/');
  const forbiddenRelationshipHeading = ['## Relationship to', 'Chatto'].join(' ');
  const text = [
    'Run `chatto init`, then edit `chatto.toml`.',
    'The entrypoint starts the `chatto` binary.',
    'The repository\'s Packages page once available.',
    'Ask on https://github.com/Yo-DDV/Towk/discussions.',
    `Follow ${forbiddenUpstreamIssue}.`,
    forbiddenRelationshipHeading,
  ].join('\n');
  assert.equal(findPublicSurfaceViolations('guide.mdx', text).length, 8);
});

test('allows attribution and inherited technical compatibility identifiers', () => {
  const text = [
    'Towk is based on Chatto.',
    '`chatto.api.v1` remains the protocol package.',
    '`CHATTO_WEBSERVER_PORT` remains an environment contract.',
    '`/tmp/chatto/operator.sock` remains the operator socket.',
  ].join('\n');
  assert.deepEqual(findPublicSurfaceViolations('compatibility.mdx', text), []);
});

test('rejects upstream support disclaimers outside legal attribution files', () => {
  assert.deepEqual(
    findPublicSurfaceViolations('apps/docs-website/src/content/docs/getting-started/faq.mdx', 'ChattoCorp does not support Towk.'),
    ['apps/docs-website/src/content/docs/getting-started/faq.mdx:1: upstream support disclaimer outside legal docs'],
  );
  assert.deepEqual(findPublicSurfaceViolations('README.md', 'ChattoCorp GmbH.'), []);
});

test('the repository public surface satisfies the policy', async () => {
  const result = await checkPublicSurface();
  assert.deepEqual(result.violations, []);
  assert.ok(result.filesChecked > 20);
});

test('governance documents are part of the public-surface policy', () => {
  assert.ok(publicRoots.includes('docs/governance'));
});

test('the contribution policy rejects private paths and internal choreography', async () => {
  const workflow = await readFile('.github/workflows/pr-policy.yml', 'utf8');
  const privatePath = /(?:^|[\s`'"(])(?:\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/i;
  assert.ok(workflow.includes(`const privatePath = ${privatePath.toString()};`));

  for (const value of [
    '/home/developer/project/file.txt',
    '/Users/developer/project/file.txt',
    'C:\\Users\\developer\\project\\file.txt',
  ]) {
    assert.match(value, privatePath);
  }
  assert.doesNotMatch('/opt/towk/towk', privatePath);
});

test('release workflows keep stable publication manual and immutable', async () => {
  const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8');
  const imageWorkflow = await readFile('.github/workflows/build-image.yml', 'utf8');
  const releaseConfig = await readFile('.goreleaser.yml', 'utf8');

  assert.doesNotMatch(releaseWorkflow, /^\s*push:\s*$/m);
  assert.match(releaseWorkflow, /Refuse an already-published release/);
  assert.match(releaseWorkflow, /Refusing to replace existing release asset/);
  assert.doesNotMatch(releaseWorkflow, /--clobber/);
  assert.equal((releaseWorkflow.match(/goreleaser release --clean/g) || []).length, 1);
  assert.match(releaseWorkflow, /EXPECTED_CHECKSUMS_SHA256/);
  assert.match(releaseWorkflow, /sha256sum -c checksums\.txt/);

  const manualImageInputs = imageWorkflow.split('workflow_dispatch:', 2)[1].split('\n\npermissions:', 1)[0];
  assert.doesNotMatch(manualImageInputs, /release_tag:/);
  assert.match(imageWorkflow, /Refusing to replace existing image tag/);
  assert.match(imageWorkflow, /Unable to prove that image tag is absent/);
  assert.match(imageWorkflow, /git show -s --format=%cI/);
  assert.match(releaseConfig, /release:\n\s+disable: true/);
  assert.match(releaseConfig, /mod_timestamp: "946684800"/);
});

test('native clipboard CI installs only the portable toolchain', async () => {
  const setupAction = await readFile('.github/actions/setup/action.yml', 'utf8');
  const ciWorkflow = await readFile('.github/workflows/ci.yml', 'utf8');
  const nativeClipboardJob = ciWorkflow.split('  test-native-file-clipboard:', 2)[1];

  assert.match(setupAction, /^  mise-install-args:\n/m);
  assert.match(setupAction, /^        install_args: \$\{\{ inputs\.mise-install-args \}\}$/m);
  assert.ok(nativeClipboardJob);
  assert.match(nativeClipboardJob, /^      MISE_TASK_RUN_AUTO_INSTALL: "false"$/m);
  assert.match(nativeClipboardJob, /^          mise-install-args: go node$/m);
});

test('quick checks and heavy diagnostics keep their intended triggers', async () => {
  const quickGate = await readFile('.github/workflows/quick-gate.yml', 'utf8');
  const fullCi = await readFile('.github/workflows/ci.yml', 'utf8');
  const security = await readFile('.github/workflows/security.yml', 'utf8');

  assert.match(quickGate, /^  pull_request:\s*$/m);
  assert.doesNotMatch(quickGate, /^  (?:push|schedule):\s*$/m);
  assert.match(quickGate, /timeout-minutes: 2/);

  for (const workflow of [fullCi, security]) {
    assert.match(workflow, /^  workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|schedule):\s*$/m);
  }
});
