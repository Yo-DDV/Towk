import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const liquidGlass = readFileSync(new URL('./liquid-glass-surfaces.css', import.meta.url), 'utf8');
const appShellEntry = readFileSync(new URL('./app-shell-depth.css', import.meta.url), 'utf8');
const appShell = [
  'app-shell-depth.tokens.css',
  'app-shell-depth.surfaces.css',
  'app-shell-depth.controls.css',
  'app-shell-depth.states.css',
  'app-shell-depth.preferences.css'
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');
const rootLayout = readFileSync(new URL('../../routes/+layout.svelte', import.meta.url), 'utf8');
const frame = readFileSync(new URL('../ui/Frame.svelte', import.meta.url), 'utf8');
const paneHeader = readFileSync(new URL('../ui/PaneHeader.svelte', import.meta.url), 'utf8');
const scrollFader = readFileSync(new URL('../ui/ScrollFader.svelte', import.meta.url), 'utf8');
const toggleChip = readFileSync(new URL('../ui/ToggleChip.svelte', import.meta.url), 'utf8');
const matrixCell = readFileSync(
  new URL('../components/rbac/MatrixCell.svelte', import.meta.url),
  'utf8'
);
const packageJson = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');

const backdropEnhancement =
  '@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';
const gradientFunction = /(?:linear|radial|conic)-gradient\s*\(/i;

function cssVariable(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS variable --${name}`);
  return match[1].trim();
}

function rgbChannels(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16)
    ];
  }

  const rgb = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!rgb) throw new Error(`Expected rgb() or six-digit hex, received ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function relativeLuminance(value: string): number {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function rgbaAlpha(value: string): number {
  const match = value.match(/[,/]\s*([0-9.]+)\s*\)$/);
  if (!match) throw new Error(`Expected rgba() value, received ${value}`);
  return Number(match[1]);
}

describe('depth-aware application surfaces', () => {
  it('loads the shell hierarchy before the compact glass specialization', () => {
    const appCssIndex = rootLayout.indexOf("import '../app.css';");
    const shellIndex = rootLayout.indexOf("import '$lib/styles/app-shell-depth.css';");
    const liquidIndex = rootLayout.indexOf("import '$lib/styles/liquid-glass-surfaces.css';");

    expect(appCssIndex).toBeGreaterThanOrEqual(0);
    expect(shellIndex).toBeGreaterThan(appCssIndex);
    expect(liquidIndex).toBeGreaterThan(shellIndex);
    expect(rootLayout.match(/app-shell-depth\.css/g)).toHaveLength(1);
    expect(rootLayout.match(/liquid-glass-surfaces\.css/g)).toHaveLength(1);

    for (const fragment of ['tokens', 'surfaces', 'controls', 'states', 'preferences']) {
      expect(appShellEntry.match(new RegExp(`app-shell-depth\\.${fragment}\\.css`, 'g'))).toHaveLength(1);
    }
  });

  it('adds styling hooks without moving or duplicating the application structure', () => {
    expect(rootLayout).toContain('data-testid="app-envelope"');
    expect(rootLayout).toContain('class="app-envelope flex h-full w-full flex-col');
    expect(frame).toContain('data-testid="app-content-frame"');
    expect(frame).toContain('class="app-content-frame flex min-h-0 flex-1');
    expect(paneHeader).toContain('data-ui="pane-header"');
    expect(paneHeader).toContain("'pane-header flex h-14 shrink-0");
    expect(scrollFader).toContain('data-ui="scroll-edge-cue"');
    expect(scrollFader).toContain("'scroll-edge-cue pointer-events-none");
    expect(toggleChip).toContain('data-ui="toggle-chip"');
    expect(toggleChip).toContain('data-tone={tone}');
    expect(matrixCell).toContain('data-ui="permission-matrix-state"');
    expect(matrixCell).toContain('data-override={isOverride');
  });

  it('keeps the dark envelope and navigation above the inset content canvas', () => {
    const darkStart = appShell.indexOf(":root[data-theme='dark']");
    const darkEnd = appShell.indexOf('/* Application shell', darkStart);
    const darkTheme = appShell.slice(darkStart, darkEnd);

    const envelope = cssVariable(darkTheme, 'towk-envelope');
    const navigation = cssVariable(darkTheme, 'towk-navigation');
    const frameFill = cssVariable(darkTheme, 'towk-frame');
    const canvas = cssVariable(darkTheme, 'towk-canvas');
    const background = cssVariable(darkTheme, 'color-background');

    expect(relativeLuminance(envelope)).toBeGreaterThan(relativeLuminance(navigation));
    expect(relativeLuminance(navigation)).toBeGreaterThan(relativeLuminance(canvas));
    expect(relativeLuminance(frameFill)).toBeGreaterThanOrEqual(relativeLuminance(canvas));
    expect(relativeLuminance(canvas)).toBeCloseTo(relativeLuminance(background), 4);
    expect(relativeLuminance(envelope)).toBeLessThan(0.02);
  });

  it('contains no decorative color-gradient function in the new material layer', () => {
    expect(liquidGlass).not.toMatch(gradientFunction);
    expect(appShell).not.toMatch(gradientFunction);
    expect(scrollFader).not.toMatch(/bg-gradient|from-background|to-transparent/);
    expect(toggleChip).not.toMatch(/bg-gradient|--tw-gradient|from-[a-z]|to-[a-z]/i);
    expect(matrixCell).not.toMatch(/bg-gradient|--tw-gradient|from-[a-z]|to-[a-z]/i);

    expect(liquidGlass).toContain('background-image: none;');
    expect(appShell).toContain('--shimmer-gradient: none;');
    expect(appShell).toContain('.shimmer-hover::before');
    expect(appShell).toContain('content: none;');
    expect(appShell).toContain('.skeleton {');
    expect(appShell).toContain('.btn-primary,');
    expect(appShell).toContain('.toggle-chip {');
    expect(appShell).toContain('.permission-matrix-state {');
    expect(appShell).toContain('.scroll-edge-cue {');
    expect(appShell).toContain('.embed-frame {');
    expect(appShell).toContain('.sidebar-item.bg-surface-100:hover');
    expect(appShell).toContain('.server-gutter-item-active:hover');
    expect(appShell).toContain("[data-testid='current-user-identity-card'] > a:hover");
    expect(appShell).toContain("inset 0 -12px 18px -18px var(--towk-key-shadow)");
  });

  it('uses stable persistent surfaces and reserves live blur for transient UI', () => {
    expect(appShell).toContain('Persistent surfaces use a stable Mica-like material');
    expect(appShell).toContain('.app-header,');
    expect(appShell).toContain('.server-gutter,');
    expect(appShell).toContain('.server-sidebar,');
    expect(appShell).toContain('.pane-header,');
    expect(appShell).toContain("[data-testid='room-view-region'] {");
    expect(appShell).toContain('background-color: var(--towk-canvas);');

    const enhancementStart = appShell.indexOf(backdropEnhancement);
    const enhancementEnd = appShell.indexOf('/* Responsive and accessibility', enhancementStart);
    const enhancement = appShell.slice(enhancementStart, enhancementEnd);

    expect(enhancement).toContain('.menu,');
    expect(enhancement).toContain('.floating-tooltip,');
    expect(enhancement).toContain('.dialog-tray,');
    expect(enhancement).toContain('dialog.bottom-sheet > div');
    expect(enhancement).not.toContain('.app-header,');
    expect(enhancement).not.toContain('.server-sidebar,');
    expect(appShell).toContain('dialog.mobile-full-screen > .dialog-tray');
    expect(appShell).toContain('A viewport-filling dialog is content, not a floating glass control.');
  });

  it('ships opaque fallbacks before bounded progressive blur', () => {
    const liquidEnhancement = liquidGlass.indexOf(backdropEnhancement);
    const shellEnhancement = appShell.indexOf(backdropEnhancement);

    expect(liquidEnhancement).toBeGreaterThan(0);
    expect(shellEnhancement).toBeGreaterThan(0);
    expect(liquidGlass.slice(0, liquidEnhancement)).not.toContain('backdrop-filter:');
    expect(appShell.slice(0, shellEnhancement)).not.toContain('backdrop-filter:');

    expect(liquidGlass).toContain('backdrop-filter: blur(16px) saturate(112%);');
    expect(liquidGlass).toContain('backdrop-filter: blur(12px) saturate(108%);');
    expect(appShell).toContain('backdrop-filter: blur(16px) saturate(112%);');
    expect(appShell).toContain('backdrop-filter: blur(12px) saturate(108%);');
    expect(`${liquidGlass}\n${appShell}`).not.toMatch(/blur\((?:1[7-9]|[2-9]\d)px\)/);
  });

  it('keeps compact glass neutral without an interior white wash', () => {
    const darkStart = liquidGlass.indexOf(":root[data-theme='dark']");
    const rulesStart = liquidGlass.indexOf(":root [data-testid='current-user-identity-card']");
    const darkTheme = liquidGlass.slice(darkStart, rulesStart);

    const fill = cssVariable(darkTheme, 'liquid-glass-translucent');
    const edge = cssVariable(darkTheme, 'liquid-glass-edge-light');
    const side = cssVariable(darkTheme, 'liquid-glass-edge-side');

    expect(rgbaAlpha(fill)).toBeGreaterThanOrEqual(0.8);
    expect(rgbaAlpha(edge)).toBeLessThanOrEqual(0.07);
    expect(rgbaAlpha(side)).toBeLessThanOrEqual(0.03);
    expect(liquidGlass).not.toContain('will-change: transform');
    expect(liquidGlass).not.toContain('filter: url(');
  });

  it('uses restrained focus and state-linked motion instead of idle glow', () => {
    expect(liquidGlass).toContain('--liquid-glass-current-border: rgba(232, 120, 59, 0.76);');
    expect(liquidGlass).toContain('0 0 0 3px var(--liquid-glass-focus-composer)');
    expect(liquidGlass).toContain('@keyframes liquid-glass-busy-pulse');
    expect(liquidGlass).toContain('animation: none !important;');
    expect(liquidGlass).not.toContain('1.15rem');
    expect(appShell).toContain('@keyframes towk-skeleton-pulse');
    expect(appShell).toContain('.choice-row-selected:hover');
    expect(appShell).toContain('.meta-badge:hover');
    expect(appShell).not.toContain('animation: shimmer');
  });

  it('respects transparency, contrast, motion, and forced-color preferences', () => {
    for (const stylesheet of [liquidGlass, appShell]) {
      expect(stylesheet).toContain('@media (prefers-reduced-transparency: reduce)');
      expect(stylesheet).toContain('@media (prefers-contrast: more)');
      expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
      expect(stylesheet).toContain('@media (forced-colors: active)');
      expect(stylesheet).toContain('backdrop-filter: none;');
    }

    expect(liquidGlass).toContain('outline: 2px solid Highlight;');
    expect(appShell).toContain('outline: 1px solid CanvasText;');
  });

  it('reuses the existing Svelte and Tailwind stack without a component-framework migration', () => {
    expect(packageJson).not.toMatch(/shadcn|bits-ui|melt-ui/i);
  });
});
