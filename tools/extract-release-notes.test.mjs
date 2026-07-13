import assert from 'node:assert/strict';
import test from 'node:test';

import { extractReleaseNotes } from './extract-release-notes.mjs';

const changelog = `# Changelog

## [0.6.0](https://example.test/v0.6.0) (2026-07-14)

Towk 0.6.0 release notes.

### Distribution

- Ships the canonical \`towk\` executable.

## [0.5.0](https://example.test/v0.5.0) (2026-07-13)

Previous release.
`;

test('extracts only the requested release section', () => {
  assert.equal(
    extractReleaseNotes(changelog, 'v0.6.0'),
    'Towk 0.6.0 release notes.\n\n### Distribution\n\n- Ships the canonical `towk` executable.\n',
  );
});

test('rejects missing, empty, and malformed release sections', () => {
  assert.throws(() => extractReleaseNotes(changelog, '0.6.0'), /invalid release tag/);
  assert.throws(() => extractReleaseNotes(changelog, 'v0.7.0'), /has no section/);
  assert.throws(() => extractReleaseNotes('## [0.6.0]\n\n## [0.5.0]\nbody', 'v0.6.0'), /is empty/);
});
