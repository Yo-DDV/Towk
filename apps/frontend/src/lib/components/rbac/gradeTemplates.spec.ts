import { describe, expect, it } from 'vitest';
import {
  GRADE_TEMPLATES,
  MEMBER_PERMISSIONS,
  MODERATOR_PERMISSIONS,
  gradeTemplateById
} from './gradeTemplates';

describe('gradeTemplates', () => {
  it('exposes moderator, helper and custom starting points', () => {
    expect(GRADE_TEMPLATES.map((template) => template.id)).toEqual([
      'moderator.v1',
      'helper.v1',
      'custom'
    ]);
  });

  it('keeps the Moderator template narrowly scoped', () => {
    expect([...MODERATOR_PERMISSIONS]).toEqual([
      'room.remove-member',
      'room.ban-member',
      'room.lock',
      'room.bypass-lock',
      'message.delete-others'
    ]);
    expect(MODERATOR_PERMISSIONS).not.toContain('room.manage');
    expect(MODERATOR_PERMISSIONS).not.toContain('room.purge-messages');
    expect(MODERATOR_PERMISSIONS).not.toContain('message.manage');
  });

  it('gives Helper no additional permissions', () => {
    const helper = gradeTemplateById('helper.v1');
    expect(helper.defaultName).toBe('helpers');
    expect(helper.defaultPingable).toBe(true);
    expect(helper.permissions).toEqual([]);
  });

  it('documents the ordinary Members inheritance once', () => {
    expect(new Set(MEMBER_PERMISSIONS).size).toBe(MEMBER_PERMISSIONS.length);
    expect(MEMBER_PERMISSIONS).toContain('message.attach');
    expect(MEMBER_PERMISSIONS).toContain('user.delete-self');
  });
});
