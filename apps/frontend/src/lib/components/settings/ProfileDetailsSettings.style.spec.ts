import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(
  new URL('./ProfileDetailsSettings.svelte', import.meta.url),
  'utf8'
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = settingsSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

describe('ProfileDetailsSettings biography layout contract', () => {
  it('keeps editor and preview cards intrinsically sized inside the responsive grid', () => {
    expect(rule('.profile-details-card')).toContain('align-self: start');
  });

  it('preserves wrapping and 44px minimum targets for every Markdown action', () => {
    expect(settingsSource).toContain('class="flex flex-wrap gap-1');
    expect(settingsSource.match(/min-h-11 min-w-11/g)).toHaveLength(8);
  });
});
