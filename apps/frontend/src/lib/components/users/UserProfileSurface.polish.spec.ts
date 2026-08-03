import { describe, expect, it } from 'vitest';
import profilePolishCss from './UserProfileSurface.polish.css?raw';

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = profilePolishCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

describe('UserProfileSurface polished layout contract', () => {
  it('keeps action icons visually separated from readable labels', () => {
    const actions = rule('.user-profile-dialog .profile-action');
    const icons = rule('.user-profile-dialog .profile-action-icon');
    const labels = rule('.user-profile-dialog .profile-action-label');

    expect(actions).toContain('grid-template-columns: 2rem minmax(0, 1fr)');
    expect(actions).toContain('gap: 0.75rem');
    expect(actions).toContain('min-height: 3.25rem');
    expect(icons).toContain('width: 2rem');
    expect(labels).toContain('word-break: normal');
    expect(labels).toContain('text-wrap: pretty');
  });

  it('bounds identity, status, and role copy without awkward mid-word wrapping', () => {
    const displayName = rule('.user-profile-dialog .profile-display-name');
    const login = rule('.user-profile-dialog .profile-login');
    const statusText = rule('.user-profile-dialog .profile-custom-status > span:last-child');
    const roleChip = rule('.user-profile-dialog .profile-role-chip');
    const roleLabel = rule('.user-profile-dialog .profile-role-label');

    expect(displayName).toContain('-webkit-line-clamp: 3');
    expect(login).toContain('white-space: nowrap');
    expect(statusText).toContain('-webkit-line-clamp: 2');
    expect(roleChip).toContain('white-space: nowrap');
    expect(roleLabel).toContain('text-overflow: ellipsis');
    expect(profilePolishCss).not.toContain('word-break: break-all');
  });

  it('uses deliberate phone, Fold/tablet, desktop, and short-landscape compositions', () => {
    expect(profilePolishCss).toContain(
      '@container user-profile (min-width: 30rem) and (max-width: 53.999rem)'
    );
    expect(profilePolishCss).toContain('@container user-profile (min-width: 54rem)');
    expect(profilePolishCss).toContain('@container user-profile (max-width: 23rem)');
    expect(profilePolishCss).toContain(
      '@media (max-height: 620px) and (min-width: 46rem)'
    );
    expect(profilePolishCss).toContain(
      'grid-template-columns: minmax(20.5rem, 22rem) minmax(0, 1fr)'
    );
  });

  it('preserves reduced-motion and forced-colors fallbacks', () => {
    expect(profilePolishCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(profilePolishCss).toContain('@media (forced-colors: active)');
    expect(profilePolishCss).toContain('border: 1px solid CanvasText');
  });
});
