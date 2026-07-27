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

test('catalog audit rejects known register and dialect regressions', () => {
  const base = new Map([
    ['settings.gif', 'Disable this option'],
    ['room.directory', 'browse the directory'],
    ['ui.file', 'File'],
    ['settings.markdown', 'Supports Markdown']
  ]);

  assert.deepEqual(
    findCatalogSemanticViolations(
      'de',
      base,
      new Map([
        ['settings.gif', 'Deaktivieren Sie diese Option'],
        ['room.directory', 'Verzeichnis öffnen'],
        ['ui.file', 'Datei'],
        ['settings.markdown', 'Unterstützt Markdown']
      ])
    )[0],
    {
      key: 'settings.gif',
      category: 'suspicious-translation (formal register in an otherwise informal interface)',
      value: 'Deaktivieren Sie diese Option'
    }
  );

  assert.deepEqual(
    findCatalogSemanticViolations(
      'es',
      base,
      new Map([
        ['settings.gif', 'Desactiva esta opción'],
        ['room.directory', 'a los que le interesan'],
        ['ui.file', 'Archivo'],
        ['settings.markdown', 'Compatible con Markdown']
      ])
    )[0],
    {
      key: 'room.directory',
      category: 'suspicious-translation (formal register and incorrect room agreement)',
      value: 'a los que le interesan'
    }
  );

  assert.deepEqual(
    findCatalogSemanticViolations(
      'pt',
      base,
      new Map([
        ['settings.gif', 'Desative esta opção'],
        ['room.directory', 'Explore o diretório'],
        ['ui.file', 'Ficheiro'],
        ['settings.markdown', 'Suporta remarcação']
      ])
    ).map(({ key }) => key),
    ['ui.file', 'settings.markdown']
  );
});

test('catalog audit allows locale-specific cognates without masking other locales', () => {
  const base = new Map([['ui.notifications', 'Notifications']]);
  assert.deepEqual(
    findCatalogSemanticViolations('fr', base, new Map([['ui.notifications', 'Notifications']])),
    []
  );
  assert.deepEqual(
    findCatalogSemanticViolations('es', base, new Map([['ui.notifications', 'Notifications']])),
    [
      {
        key: 'ui.notifications',
        category: 'translation-identical-to-english',
        value: 'Notifications'
      }
    ]
  );
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

test('Svelte audit ignores expressions and approved keyboard tokens', () => {
  const source = `<button onclick={(event) => {
    if (event.clientX > rect.right || event.clientY < rect.top) close();
  }}><kbd>Esc</kbd></button>`;
  assert.deepEqual(findSvelteVisibleLiterals('Dialog.svelte', source), []);
});

test('script audit ignores documentation comments', () => {
  const source = `// toast.error('Documentation example')
/** toast.success('Another example') */
const ok = true;`;
  assert.deepEqual(findScriptVisibleLiterals('toast.ts', source), []);
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

test('Go audit finds hard-coded public responses and raw internal errors', () => {
  const source = `c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
c.String(http.StatusInternalServerError, "Application failed")
c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})`;
  assert.deepEqual(findGoVisibleLiterals('handler.go', source), [
    {
      path: 'handler.go',
      line: 1,
      category: 'hard-coded public backend response',
      value: 'Invalid request'
    },
    {
      path: 'handler.go',
      line: 2,
      category: 'hard-coded public backend body',
      value: 'Application failed'
    },
    {
      path: 'handler.go',
      line: 3,
      category: 'raw backend error exposed to user',
      value: 'c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()'
    }
  ]);
});

test('line-level audit exemptions are explicit and local', () => {
  const source = `<button title="OAuth">OAuth</button> <!-- i18n-audit-ignore -->`;
  assert.deepEqual(findSvelteVisibleLiterals('OauthButton.svelte', source), []);
});
