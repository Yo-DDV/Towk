import { g } from '$lib/i18n/gradeMessages.svelte';
import { gradeVisual } from './gradeVisuals';

export type GradeTemplateId = 'helper.v1' | 'moderator.v1' | 'custom';

export type GradeTemplate = {
  id: GradeTemplateId;
  icon: string;
  title: () => string;
  description: () => string;
  defaultName: string;
  defaultDisplayName: () => string;
  defaultDescription: () => string;
  defaultColor: string;
  defaultPingable: boolean;
  permissions: readonly string[];
};

export const MEMBER_PERMISSIONS = [
  'room.list',
  'room.join',
  'message.post',
  'message.post-in-thread',
  'message.attach',
  'message.voice',
  'message.react',
  'message.echo',
  'user.delete-self'
] as const;

export const MODERATOR_PERMISSIONS = [
  'room.remove-member',
  'room.ban-member',
  'room.lock',
  'room.bypass-lock',
  'message.delete-others'
] as const;

export const GRADE_TEMPLATES: readonly GradeTemplate[] = [
  {
    id: 'moderator.v1',
    icon: gradeVisual('moderator').icon,
    title: g['grades.templates.moderator.title'],
    description: g['grades.templates.moderator.description'],
    defaultName: 'moderation-team',
    defaultDisplayName: g['grades.templates.moderator.default_name'],
    defaultDescription: g['grades.templates.moderator.default_description'],
    defaultColor: '#16A34A',
    defaultPingable: true,
    permissions: MODERATOR_PERMISSIONS
  },
  {
    id: 'helper.v1',
    icon: gradeVisual('helper').icon,
    title: g['grades.templates.helper.title'],
    description: g['grades.templates.helper.description'],
    defaultName: 'helpers',
    defaultDisplayName: g['grades.templates.helper.default_name'],
    defaultDescription: g['grades.templates.helper.default_description'],
    defaultColor: '#0891B2',
    defaultPingable: true,
    permissions: []
  },
  {
    id: 'custom',
    icon: gradeVisual('custom').icon,
    title: g['grades.templates.custom.title'],
    description: g['grades.templates.custom.description'],
    defaultName: '',
    defaultDisplayName: () => '',
    defaultDescription: () => '',
    defaultColor: '#2563EB',
    defaultPingable: false,
    permissions: []
  }
];

export function gradeTemplateById(id: GradeTemplateId): GradeTemplate {
  return GRADE_TEMPLATES.find((template) => template.id === id) ?? GRADE_TEMPLATES[2];
}
