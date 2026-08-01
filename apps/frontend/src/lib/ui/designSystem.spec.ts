import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESIGN_SYSTEM_FAMILIES, DESIGN_SYSTEM_PRIMITIVES } from './designSystem';

function exportedComponents(relativePath: string): string[] {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return [...source.matchAll(/export \{ default as (\w+) \} from/g)].map((match) => match[1]);
}

function registeredComponents(module: '$lib/ui' | '$lib/ui/form'): string[] {
  return DESIGN_SYSTEM_PRIMITIVES.filter((primitive) => primitive.module === module).map(
    (primitive) => primitive.name
  );
}

describe('frontend design-system registry', () => {
  it('registers every exported UI and form primitive exactly once', () => {
    const registrations = DESIGN_SYSTEM_PRIMITIVES.map(
      (primitive) => `${primitive.module}:${primitive.name}`
    );

    expect(new Set(registrations).size).toBe(registrations.length);

    for (const [module, barrel] of [
      ['$lib/ui', './index.ts'],
      ['$lib/ui/form', './form/index.ts']
    ] as const) {
      const exported = exportedComponents(barrel);
      const registered = registeredComponents(module);

      expect(exported.length).toBeGreaterThan(0);
      expect(registered).toEqual(expect.arrayContaining(exported));
    }
  });

  it('keeps every contract complete and assigned to a canonical family', () => {
    for (const primitive of DESIGN_SYSTEM_PRIMITIVES) {
      expect(DESIGN_SYSTEM_FAMILIES).toContain(primitive.family);
      expect(primitive.useWhen.trim().length).toBeGreaterThan(20);
      expect(primitive.avoidWhen.trim().length).toBeGreaterThan(20);
      expect(primitive.responsive.trim().length).toBeGreaterThan(20);
      expect(primitive.accessibility.trim().length).toBeGreaterThan(20);
    }
  });

  it('keeps every declared Storybook entry on disk', () => {
    const storyEntries = DESIGN_SYSTEM_PRIMITIVES.filter((primitive) => primitive.story);

    expect(storyEntries.length).toBeGreaterThanOrEqual(8);

    for (const primitive of storyEntries) {
      const storyPath = fileURLToPath(new URL(primitive.story!, import.meta.url));
      expect(existsSync(storyPath), `${primitive.name} story is missing`).toBe(true);
    }
  });

  it('provides live stories for high-risk adaptive and modal primitives', () => {
    const requiredStories = [
      'BottomSheet',
      'ConfirmDialog',
      'ContextMenu',
      'Dialog',
      'EmptyState',
      'FormDialog',
      'Combobox',
      'Button'
    ];

    for (const name of requiredStories) {
      const primitive = DESIGN_SYSTEM_PRIMITIVES.find((entry) => entry.name === name);
      expect(primitive, `${name} is not registered`).toBeDefined();
      expect(primitive?.story, `${name} does not declare a story`).toBeTruthy();
    }
  });
});
