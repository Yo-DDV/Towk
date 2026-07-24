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

  it('combines the normal shell spacing with the safe area without stacking both', () => {
    expect(appTemplate).toMatch(
      /body\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*100vh;[^}]*padding-bottom:\s*max\(\s*0px,\s*calc\(env\(safe-area-inset-bottom,\s*0px\)\s*-\s*0\.5rem\)\s*\);[^}]*\}/s
    );
    expect(appTemplate).not.toContain('padding-bottom: env(safe-area-inset-bottom, 0px);');
    expect(appTemplate).toMatch(
      /body\[data-visual-keyboard-open\]\s*\{[^}]*min-height:\s*0;[^}]*padding-bottom:\s*0;[^}]*\}/s
    );
  });
});
