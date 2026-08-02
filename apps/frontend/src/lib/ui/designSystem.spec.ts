import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { DESIGN_SYSTEM_FAMILIES, DESIGN_SYSTEM_PRIMITIVES } from './designSystem';

function exportedComponents(relativePath: string): string[] {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, 'utf8');
  const sourceFile = ts.createSourceFile(
    fileURLToPath(fileUrl),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const exports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'default') exports.push(element.name.text);
    }
  }

  return exports;
}

function registeredComponents(module: '$lib/ui' | '$lib/ui/form'): string[] {
  return DESIGN_SYSTEM_PRIMITIVES.filter((primitive) => primitive.module === module).map(
    (primitive) => primitive.name
  );
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

function setDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

describe('frontend design-system registry', () => {
  it('registers every exported UI and form primitive exactly once', () => {
    const registrations = DESIGN_SYSTEM_PRIMITIVES.map(
      (primitive) => `${primitive.module}:${primitive.name}`
    );

    expect(duplicates(registrations)).toEqual([]);

    for (const [module, barrel] of [
      ['$lib/ui', './index.ts'],
      ['$lib/ui/form', './form/index.ts']
    ] as const) {
      const exported = exportedComponents(barrel);
      const registered = registeredComponents(module);

      expect(exported.length).toBeGreaterThan(0);
      expect({
        duplicateExports: duplicates(exported),
        duplicateRegistrations: duplicates(registered),
        missingRegistrations: setDifference(exported, registered),
        staleRegistrations: setDifference(registered, exported)
      }).toEqual({
        duplicateExports: [],
        duplicateRegistrations: [],
        missingRegistrations: [],
        staleRegistrations: []
      });
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
