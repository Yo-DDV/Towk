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
    expect(fallback).toContain('--liquid-glass-fill: rgb(248 250 252);');
    expect(fallback).toContain('--liquid-glass-fill: rgb(38 38 42);');
    expect(fallback).toContain('background-color: var(--liquid-glass-current-fill);');
    expect(fallback).toContain('inset 0 0 0 1px var(--liquid-glass-current-border)');
    expect(fallback).not.toMatch(/\n\s*border\s*:/);
    expect(fallback).not.toContain('backdrop-filter:');
  });

  it('progressively enhances supported engines without making blur mandatory', () => {
    expect(stylesheet).toContain(backdropEnhancement);
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(15px) saturate(132%);');
    expect(stylesheet).toContain('backdrop-filter: blur(15px) saturate(132%);');
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(10px) saturate(125%);');
    expect(stylesheet).toContain('backdrop-filter: blur(10px) saturate(125%);');
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
