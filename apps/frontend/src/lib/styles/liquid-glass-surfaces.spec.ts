import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../../routes/+layout.svelte', import.meta.url), 'utf8');
const frame = readFileSync(new URL('../ui/Frame.svelte', import.meta.url), 'utf8');
const paneHeader = readFileSync(new URL('../ui/PaneHeader.svelte', import.meta.url), 'utf8');
const scrollFader = readFileSync(new URL('../ui/ScrollFader.svelte', import.meta.url), 'utf8');
const toggleChip = readFileSync(new URL('../ui/ToggleChip.svelte', import.meta.url), 'utf8');
const matrixCell = readFileSync(
  new URL('../components/rbac/MatrixCell.svelte', import.meta.url),
  'utf8'
);
const messageComposer = readFileSync(
  new URL('../components/composer/MessageComposer.svelte', import.meta.url),
  'utf8'
);
const packageJson = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
const liquidGlass = readFileSync(new URL('./liquid-glass-surfaces.css', import.meta.url), 'utf8');
const shellEntry = readFileSync(new URL('./app-shell-depth.css', import.meta.url), 'utf8');
const shell = [
  'app-shell-depth.tokens.css',
  'app-shell-depth.surfaces.css',
  'app-shell-depth.controls.css',
  'app-shell-depth.states.css',
  'app-shell-depth.preferences.css'
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

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

function expectAchromatic(value: string) {
  const [red, green, blue] = rgbChannels(value);
  expect(red).toBe(green);
  expect(green).toBe(blue);
}

function relativeLuminance(value: string): number {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe('depth-aware application surfaces', () => {
  it('loads the material layers in deterministic order', () => {
    const appCssIndex = rootLayout.indexOf("import '../app.css';");
    const shellIndex = rootLayout.indexOf("import '$lib/styles/app-shell-depth.css';");
    const liquidIndex = rootLayout.indexOf("import '$lib/styles/liquid-glass-surfaces.css';");

    expect(appCssIndex).toBeGreaterThanOrEqual(0);
    expect(shellIndex).toBeGreaterThan(appCssIndex);
    expect(liquidIndex).toBeGreaterThan(shellIndex);
    expect(rootLayout.match(/app-shell-depth\.css/g)).toHaveLength(1);
    expect(rootLayout.match(/liquid-glass-surfaces\.css/g)).toHaveLength(1);

    for (const fragment of ['tokens', 'surfaces', 'controls', 'states', 'preferences']) {
      expect(shellEntry.match(new RegExp(`app-shell-depth\\.${fragment}\\.css`, 'g'))).toHaveLength(
        1
      );
    }
  });

  it('keeps structural hooks without moving the application layout', () => {
    expect(rootLayout).toContain('data-testid="app-envelope"');
    expect(rootLayout).toContain('class="app-envelope flex h-full w-full flex-col');
    expect(frame).toContain('data-testid="app-content-frame"');
    expect(frame).toContain('class="app-content-frame flex min-h-0 flex-1');
    expect(paneHeader).toContain('data-ui="pane-header"');
    expect(scrollFader).toContain('data-ui="scroll-edge-cue"');
    expect(toggleChip).toContain('data-ui="toggle-chip"');
    expect(matrixCell).toContain('data-ui="permission-matrix-state"');
  });

  it('uses a comfortable achromatic dark hierarchy', () => {
    const darkStart = shell.indexOf(":root[data-theme='dark']");
    const darkEnd = shell.indexOf('/* Application shell', darkStart);
    const darkTheme = shell.slice(darkStart, darkEnd);

    const neutralVariables = [
      'color-background',
      'color-text',
      'color-text-top',
      'color-muted',
      'color-border',
      'color-surface',
      'color-surface-100',
      'color-surface-200',
      'color-surface-300',
      'color-surface-highlighted',
      'color-input',
      'color-input-border',
      'color-primary',
      'color-primary-hover',
      'color-panel-tint',
      'towk-canvas',
      'towk-content-raised',
      'towk-envelope',
      'towk-frame',
      'towk-navigation',
      'towk-control',
      'towk-control-hover',
      'towk-control-pressed',
      'towk-control-subtle',
      'towk-transient-solid',
      'towk-transient-glass',
      'towk-stroke',
      'towk-stroke-strong',
      'towk-edge-light',
      'towk-edge-soft',
      'towk-focus-neutral',
      'towk-action-primary',
      'towk-action-primary-hover'
    ];

    for (const name of neutralVariables) expectAchromatic(cssVariable(darkTheme, name));

    const envelope = cssVariable(darkTheme, 'towk-envelope');
    const navigation = cssVariable(darkTheme, 'towk-navigation');
    const canvas = cssVariable(darkTheme, 'towk-canvas');
    const frameFill = cssVariable(darkTheme, 'towk-frame');
    const background = cssVariable(darkTheme, 'color-background');
    const envelopeChannel = rgbChannels(envelope)[0];
    const canvasChannel = rgbChannels(canvas)[0];

    expect(relativeLuminance(envelope)).toBeGreaterThan(relativeLuminance(navigation));
    expect(relativeLuminance(navigation)).toBeGreaterThan(relativeLuminance(canvas));
    expect(relativeLuminance(frameFill)).toBeGreaterThanOrEqual(relativeLuminance(canvas));
    expect(relativeLuminance(canvas)).toBeCloseTo(relativeLuminance(background), 4);
    expect(relativeLuminance(canvas)).toBeGreaterThan(0.008);
    expect(relativeLuminance(canvas)).toBeLessThan(0.02);
    expect(envelopeChannel - canvasChannel).toBeGreaterThanOrEqual(10);
    expect(canvasChannel).toBeGreaterThanOrEqual(24);
  });

  it('covers the whole outer envelope with one neutral surface', () => {
    expect(shell).toContain('html,\nbody {\n  background-color: var(--towk-envelope);');
    expect(shell).toContain('.app-header {\n  background-color: var(--towk-envelope);');
    expect(shell).toContain('.app-envelope {');
    expect(shell).toContain('background-color: var(--towk-envelope);');
  });

  it('contains no decorative gradients or saturation amplification', () => {
    expect(appCss).not.toMatch(gradientFunction);
    expect(shell).not.toMatch(gradientFunction);
    expect(liquidGlass).not.toMatch(gradientFunction);
    expect(scrollFader).not.toMatch(/bg-gradient|from-background|to-transparent/);
    expect(toggleChip).not.toMatch(/bg-gradient|--tw-gradient/i);
    expect(matrixCell).not.toMatch(/bg-gradient|--tw-gradient/i);
    expect(`${shell}\n${liquidGlass}`).toContain('saturate(100%)');
    expect(`${shell}\n${liquidGlass}`).not.toMatch(/saturate\((?:10[1-9]|1[1-9]\d|[2-9]\d\d)%\)/);
  });

  it('keeps blur bounded and persistent surfaces opaque', () => {
    expect(liquidGlass).toContain('backdrop-filter: blur(16px) saturate(100%);');
    expect(liquidGlass).toContain('backdrop-filter: blur(12px) saturate(100%);');
    expect(shell).toContain('backdrop-filter: blur(16px) saturate(100%);');
    expect(shell).toContain('backdrop-filter: blur(12px) saturate(100%);');
    expect(`${liquidGlass}\n${shell}`).not.toMatch(/blur\((?:1[7-9]|[2-9]\d)px\)/);
    expect(shell).toContain('Persistent surfaces use a stable Mica-like material');
  });

  it('preserves accessibility fallbacks and the existing stack', () => {
    for (const stylesheet of [liquidGlass, shell]) {
      expect(stylesheet).toContain('@media (prefers-reduced-transparency: reduce)');
      expect(stylesheet).toContain('@media (prefers-contrast: more)');
      expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
      expect(stylesheet).toContain('@media (forced-colors: active)');
      expect(stylesheet).toContain('backdrop-filter: none;');
    }

    expect(packageJson).not.toMatch(/shadcn|bits-ui|melt-ui/i);
  });

  it('keeps the orange focus perimeter in motion without overriding the glass shell', () => {
    expect(messageComposer).toContain('animation: composer-focus-orbit');
    expect(messageComposer).toContain('@media (prefers-reduced-motion: reduce)');
    expect(liquidGlass).not.toMatch(
      /message-composer-shell[^}]*composer-focus-shell::before\s*\{[^}]*content:\s*none/is
    );
  });
});
