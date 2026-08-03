import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorSource = readFileSync(new URL('./ProfileBannerEditor.svelte', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = editorSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

describe('ProfileBannerEditor touch target contract', () => {
  it('keeps navigation and mutation controls at least 44 physical CSS pixels tall', () => {
    expect(rule('.profile-banner-back')).toContain('min-height: 44px');
    expect(rule('.profile-banner-editor-actions :global(button)')).toContain('min-height: 44px');
  });
});
