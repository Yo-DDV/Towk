import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appTemplate = readFileSync(new URL('./app.html', import.meta.url), 'utf8');

describe('iOS standalone viewport shell', () => {
  it('scopes the fallback to installed WebKit touch devices', () => {
    expect(appTemplate).toContain('@supports (-webkit-touch-callout: none)');
    expect(appTemplate).toContain(
      '@media (display-mode: standalone) and (hover: none) and (pointer: coarse)'
    );
  });

  it('keeps the shell edge to edge and protects only composer controls', () => {
    expect(appTemplate).toMatch(
      /body\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*100vh;[^}]*\}/s
    );
    expect(appTemplate).not.toMatch(/body\s*\{[^}]*padding-bottom:/s);
    expect(appTemplate).toContain('@supports selector(div:has(> .composer-focus-shell))');
    expect(appTemplate).toMatch(
      /body:not\(\[data-visual-keyboard-open\]\)\s*div:has\(>\s*\.composer-focus-shell\)\s*\{[^}]*padding-bottom:\s*max\(\s*0\.5rem,\s*calc\(env\(safe-area-inset-bottom,\s*0px\)\s*-\s*0\.5rem\)\s*\);[^}]*\}/s
    );
    expect(appTemplate).toMatch(
      /body\[data-visual-keyboard-open\]\s*\{[^}]*min-height:\s*0;[^}]*\}/s
    );
  });
});
