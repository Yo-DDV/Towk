import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n/runtime';
import {
  localizedDecisionState,
  localizedRoleDescription,
  localizedRoleDisplayName,
  localizedScopeLabel,
  localizedSubjectKind
} from './rbacLabels';

describe('rbacLabels', () => {
  beforeEach(async () => {
    await setLocale('en');
  });

  it('localizes persisted system role names and descriptions in French', async () => {
    await setLocale('fr');

    expect(localizedRoleDisplayName('owner', 'Owner')).toBe('Propriétaire');
    expect(localizedRoleDisplayName('admin', 'Admin')).toBe('Administrateur');
    expect(localizedRoleDisplayName('moderator', 'Moderator')).toBe('Modérateur');
    expect(localizedRoleDisplayName('everyone', 'Everyone')).toBe('Tous les membres');
    expect(localizedRoleDescription('everyone', 'All authenticated users')).toBe(
      'Tous les utilisateurs authentifiés'
    );
  });

  it('keeps custom role labels as user-owned data', () => {
    expect(localizedRoleDisplayName('support', 'Support Team')).toBe('Support Team');
    expect(localizedRoleDescription('support', 'Escalation crew')).toBe('Escalation crew');
  });

  it('localizes RBAC state and server scope labels without rewriting custom scope names', async () => {
    await setLocale('fr');

    expect(localizedDecisionState('allow')).toBe('Autoriser');
    expect(localizedDecisionState('deny')).toBe('Refuser');
    expect(localizedDecisionState('neutral')).toBe('Aucune décision');
    expect(localizedSubjectKind('role')).toBe('ce rôle');
    expect(localizedScopeLabel({ kind: 'SERVER', label: 'Server' })).toBe('Serveur');
    expect(localizedScopeLabel({ kind: 'GROUP', label: 'Lobby' })).toBe('Lobby');
  });
});
