import { describe, expect, it } from 'vitest';
import profilePolishCss from './UserProfileSurface.polish.css?raw';

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = profilePolishCss.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

describe('UserProfileSurface polished layout contract', () => {
  it('keeps action icons in a fixed lane separated from readable labels', () => {
    const actions = rule('.user-profile-dialog .profile-actions > .profile-action');
    const icons = rule(
      '.user-profile-dialog .profile-actions > .profile-action .profile-action-icon'
    );
    const labels = rule(
      '.user-profile-dialog .profile-actions > .profile-action .profile-action-label'
    );

    expect(actions).toContain('grid-template-columns: 2rem minmax(0, 1fr)');
    expect(actions).toContain('gap: 0.75rem');
    expect(actions).toContain('min-height: 3.25rem');
    expect(icons).toContain('width: 2rem');
    expect(labels).toContain('hyphens: none');
    expect(labels).toContain('overflow-wrap: break-word');
    expect(labels).toContain('word-break: normal');
    expect(labels).toContain('text-wrap: pretty');
  });

  it('bounds identity, status, and role copy without awkward mid-word wrapping', () => {
    const displayName = rule(
      '.user-profile-dialog .profile-name-block .profile-display-name'
    );
    const login = rule('.user-profile-dialog .profile-name-block .profile-login');
    const statusText = rule(
      '.user-profile-dialog .profile-status-row > .profile-custom-status > span:last-child'
    );
    const roleChip = rule(
      '.user-profile-dialog .profile-role-list > .profile-role-chip'
    );
    const roleLabel = rule(
      '.user-profile-dialog .profile-role-chip > .profile-role-label'
    );

    expect(displayName).toContain('max-height: none');
    expect(displayName).toContain('-webkit-line-clamp: 3');
    expect(displayName).toContain('overflow-wrap: break-word');
    expect(displayName).toContain('word-break: normal');
    expect(login).toContain('white-space: nowrap');
    expect(statusText).toContain('-webkit-line-clamp: 2');
    expect(statusText).toContain('overflow-wrap: break-word');
    expect(statusText).toContain('word-break: normal');
    expect(roleChip).toContain('white-space: nowrap');
    expect(roleLabel).toContain('text-overflow: ellipsis');
    expect(profilePolishCss).not.toContain('hyphens: auto');
    expect(profilePolishCss).not.toContain('word-break: break-all');
  });

  it('uses deliberate phone, Fold/tablet, desktop, and short-landscape compositions', () => {
    expect(profilePolishCss).toContain(
      '@container user-profile (min-width: 30rem) and (max-width: 53.999rem)'
    );
    expect(profilePolishCss).toContain('@container user-profile (min-width: 54rem)');
    expect(profilePolishCss).toContain('@container user-profile (max-width: 27rem)');
    expect(profilePolishCss).toContain('@container user-profile (max-width: 23rem)');
    expect(profilePolishCss).toContain(
      '@media (max-height: 620px) and (min-width: 46rem)'
    );
    expect(profilePolishCss).toContain(
      'grid-template-columns: minmax(20.5rem, 22rem) minmax(0, 1fr)'
    );
    expect(profilePolishCss).toContain(
      'grid-template-columns: minmax(20.5rem, 42%) minmax(0, 1fr)'
    );
    expect(profilePolishCss).toContain('border-right: 1px solid var(--color-border)');
    expect(profilePolishCss).toContain('border-bottom: 0');
    expect(profilePolishCss).toContain('width: 6rem');
    expect(profilePolishCss).toContain('height: 7.5rem');
  });

  it('uses selectors strong enough to override the component baseline deterministically', () => {
    expect(profilePolishCss).toContain(
      '.user-profile-dialog .profile-actions > .profile-action'
    );
    expect(profilePolishCss).toContain(
      '.user-profile-dialog .profile-actions > .profile-action .profile-action-icon'
    );
    expect(profilePolishCss).toContain(
      '.user-profile-dialog .profile-identity-body .profile-status-row'
    );
    expect(profilePolishCss).toContain(
      '.user-profile-dialog .profile-role-list > .profile-role-chip'
    );
    expect(profilePolishCss).not.toContain('.profile-error-copy');
    expect(profilePolishCss).not.toContain('.profile-retry');
  });

  it('preserves reduced-motion and forced-colors fallbacks', () => {
    expect(profilePolishCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(profilePolishCss).toContain('@media (forced-colors: active)');
    expect(profilePolishCss).toContain('border: 1px solid CanvasText');
    expect(profilePolishCss).toContain('scale: 1');
    expect(profilePolishCss).toContain('transform: none');
  });
});
