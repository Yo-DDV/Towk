import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./liquid-glass-surfaces.css', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../../routes/+layout.svelte', import.meta.url), 'utf8');

const backdropEnhancement =
  '@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';
const darkThemeStart = stylesheet.indexOf(":root[data-theme='dark']");
const surfaceRulesStart = stylesheet.indexOf(":root [data-testid='current-user-identity-card']");
const lightTheme = stylesheet.slice(0, darkThemeStart);
const darkTheme = stylesheet.slice(darkThemeStart, surfaceRulesStart);

function cssVariable(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS variable --${name}`);
  return match[1].trim();
}

function rgbaAlpha(value: string): number {
  const match = value.match(/,\s*([0-9.]+)\)$/);
  if (!match) throw new Error(`Expected rgba() value, received ${value}`);
  return Number(match[1]);
}

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
    expect(stylesheet).toContain('transparent 6%');
    expect(stylesheet).toContain('transparent 94%');
    expect(stylesheet).not.toContain('radial-gradient');
    expect(stylesheet).not.toContain('at 4% -58%');
    expect(stylesheet).not.toContain('at 104% 136%');
    expect(stylesheet).not.toContain('--liquid-glass-caustic');
    expect(stylesheet).not.toContain('--liquid-glass-lift');
    expect(stylesheet).not.toContain('-6px -6px');
  });

  it('keeps the regular-style material neutral and bounds internal luminance', () => {
    const lightFaceTop = cssVariable(lightTheme, 'liquid-glass-face-top');
    const darkFaceTop = cssVariable(darkTheme, 'liquid-glass-face-top');
    const lightEdgeHighlight = cssVariable(lightTheme, 'liquid-glass-edge-highlight');
    const darkEdgeHighlight = cssVariable(darkTheme, 'liquid-glass-edge-highlight');
    const lightFill = cssVariable(lightTheme, 'liquid-glass-fill-translucent');
    const darkFill = cssVariable(darkTheme, 'liquid-glass-fill-translucent');

    expect(lightFaceTop).toContain('148, 163, 184');
    expect(darkFaceTop).toContain('148, 163, 184');
    expect(lightEdgeHighlight).toContain('226, 232, 240');
    expect(darkEdgeHighlight).toContain('203, 213, 225');
    expect(rgbaAlpha(lightFaceTop)).toBeLessThanOrEqual(0.04);
    expect(rgbaAlpha(darkFaceTop)).toBeLessThanOrEqual(0.02);
    expect(rgbaAlpha(lightEdgeHighlight)).toBeLessThanOrEqual(0.22);
    expect(rgbaAlpha(darkEdgeHighlight)).toBeLessThanOrEqual(0.07);
    expect(rgbaAlpha(lightFill)).toBeLessThanOrEqual(0.5);
    expect(rgbaAlpha(darkFill)).toBeLessThanOrEqual(0.54);
    expect(stylesheet).not.toContain('rgba(255, 255, 255');
  });

  it('progressively enhances supported engines without making blur mandatory', () => {
    expect(stylesheet).toContain(backdropEnhancement);
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(18px) saturate(115%);');
    expect(stylesheet).toContain('backdrop-filter: blur(18px) saturate(115%);');
    expect(stylesheet).toContain('-webkit-backdrop-filter: blur(12px) saturate(110%);');
    expect(stylesheet).toContain('backdrop-filter: blur(12px) saturate(110%);');
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
