import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findCatalogSemanticViolations,
  findGoVisibleLiterals,
  findScriptVisibleLiterals,
  findSvelteVisibleLiterals,
  flattenCatalog
} from './audit-user-visible-copy.mjs';

test('flattenCatalog preserves dotted message paths', () => {
  assert.deepEqual(
    [...flattenCatalog({ chat: { title: 'Notifications', empty: 'Nothing here' } })],
    [
      ['chat.title', 'Notifications'],
      ['chat.empty', 'Nothing here']
    ]
  );
});

test('catalog audit reports untranslated and suspicious prose', () => {
  const base = new Map([
    ['chat.title', 'Notifications'],
    ['chat.format', 'GIF'],
    ['chat.empty', 'All caught up']
  ]);
  const es = new Map([
    ['chat.title', 'Notifications'],
    ['chat.format', 'GIF'],
    ['chat.empty', 'Todos atrapados']
  ]);
  assert.deepEqual(findCatalogSemanticViolations('es', base, es), [
    {
      key: 'chat.title',
      category: 'translation-identical-to-english',
      value: 'Notifications'
    },
    {
      key: 'chat.empty',
      category: 'suspicious-translation (literal translation of “caught”)',
      value: 'Todos atrapados'
    }
  ]);
});

test('Svelte audit finds visible text and user-facing attributes only', () => {
  const source = `<script>const title = 'Internal';</script>
<div class="card" title="Open profile">Profile details</div>
<div aria-label={m.label()}>{m.body()}</div>`;
  assert.deepEqual(findSvelteVisibleLiterals('Profile.svelte', source), [
    {
      path: 'Profile.svelte',
      line: 2,
      category: 'hard-coded user-facing attribute',
      value: 'Open profile'
    },
    {
      path: 'Profile.svelte',
      line: 2,
      category: 'hard-coded markup text',
      value: 'Profile details'
    }
  ]);
});

test('script audit finds notification copy but not technical tokens', () => {
  const source = `const first = { summary: 'New message' };
const second = { title: 'Towk' };
showNotification('Incoming call', { body: localized });`;
  assert.deepEqual(findScriptVisibleLiterals('notifications.ts', source), [
    {
      path: 'notifications.ts',
      line: 1,
      category: 'hard-coded user-facing property',
      value: 'New message'
    },
    {
      path: 'notifications.ts',
      line: 3,
      category: 'hard-coded user-facing call',
      value: 'Incoming call'
    }
  ]);
});

test('Go audit finds user-facing mail and notification fields', () => {
  const source = `mail := Message{Subject: "Reset your password", Body: body}
notification := Push{Title: \`New message\`}`;
  assert.deepEqual(findGoVisibleLiterals('mail.go', source), [
    {
      path: 'mail.go',
      line: 1,
      category: 'hard-coded backend user-facing field',
      value: 'Reset your password'
    },
    {
      path: 'mail.go',
      line: 2,
      category: 'hard-coded backend user-facing field',
      value: 'New message'
    }
  ]);
});

test('line-level audit exemptions are explicit and local', () => {
  const source = `<button title="OAuth">OAuth</button> <!-- i18n-audit-ignore -->`;
  assert.deepEqual(findSvelteVisibleLiterals('OauthButton.svelte', source), []);
});
