import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('read receipt preference page', () => {
  it('renders and persists the reciprocal read receipt switch', () => {
    const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');
    const updateStart = source.indexOf('accountAPI().updateSettings({');
    const updateEnd = source.indexOf('});', updateStart);

    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(updateEnd).toBeGreaterThan(updateStart);
    expect(source.slice(updateStart, updateEnd)).toContain('readReceiptsEnabled');
    expect(source).toContain("settings.preferences.read_receipts.title");
    expect(source).toContain('bind:checked={readReceiptsEnabled}');
    expect(source).toContain('disabled={isSaving}');
    expect(source).toContain('readReceiptsEnabled = settings.readReceiptsEnabled;');
  });
});
