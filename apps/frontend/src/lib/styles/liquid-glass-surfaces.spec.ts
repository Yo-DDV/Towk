import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./liquid-glass-surfaces.css', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../../routes/+layout.svelte', import.meta.url), 'utf8');

const backdropEnhancement =
  '@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';

describe('liquid glass surface stylesheet', () => {
  it('loads once from the application shell and targets only the intended surfaces', () => {
    expect(rootLayout).toContain("import '$lib/styles/liquid-glass-surfaces.css';");
    expect(stylesheet).toContain("[data-testid='current-user-identity-card']");
    expect(stylesheet).toContain("[data-testid='message-composer-shell'].composer-focus-shell");
  });

  it('ships an opaque, layout-neutral fallback before backdrop enhancement', () => {
    const enhancementIndex = stylesheet.indexOf(backdropEnhancement);
    expect(enhancementIndex).toBeGreaterThan(0);

    const fallback = stylesheet.slice(0, enhancementIndex);
    expect(fallback).toContain('--liquid-glass-fill: rgb(248, 250, 252);');
    expect(fallback).toContain('--liquid-glass-fill: rgb(38, 38, 42);');
    expect(fallback).toContain('background-color: var(--liquid-glass-current-fill);');
    expect(fallback).toContain('inset 0 0 0 1px var(--liquid-glass-current-border)');
    expect(fallback).not.toMatch(/\n\s*border\s*:/);
    expect(fallback).not.toContain('backdrop-filter:');
  });

  it('uses uniform face and perimeter lighting without fixed interior hotspots', () => {
    expect(stylesheet).toContain('--liquid-glass-face-top:');
    expect(stylesheet).toContain('--liquid-glass-face-middle:');
    expect(stylesheet).toContain('--liquid-glass-face-bottom:');
    expect(stylesheet).toContain('--liquid-glass-edge-highlight:');
    expect(stylesheet).toContain('--liquid-glass-edge-sheen:');
    expect(stylesheet).toContain('inset 1px 0 0 var(--liquid-glass-edge-sheen)');
    expect(stylesheet).toContain('inset -1px 0 0 var(--liquid-glass-edge-sheen)');
    expect(stylesheet).toContain('transparent 12%');
    expect(stylesheet).toContain('transparent 88%');
    expect(stylesheet).not.toContain('radial-gradient');
    expect(stylesheet).not.toContain('at 4% -58%');
    expect(stylesheet).not.toContain('at 104% 136%');
    expect(stylesheet).not.toContain('--liquid-glass-caustic');
    expect(stylesheet).not.toContain('--liquid-glass-lift');
    expect(stylesheet).not.toContain('-6px -6px');
  });

  it('progressively enhances supported engines without making blur mandatory', () => {
    expect(stylesheet).toContain(backdropEnhancement);
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(18px) saturate(135%);');
    expect(stylesheet).toContain('backdrop-filter: blur(18px) saturate(135%);');
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(12px) saturate(128%);');
    expect(stylesheet).toContain('backdrop-filter: blur(12px) saturate(128%);');
  });

  it('respects transparency, contrast, motion, and forced-color preferences', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(stylesheet).toContain('@media (prefers-contrast: more)');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesheet).toContain('@media (forced-colors: active)');
    expect(stylesheet).toContain('outline: 1px solid CanvasText;');
    expect(stylesheet).toContain('outline: 2px solid Highlight;');
    expect(stylesheet).not.toContain('will-change');
  });
});
