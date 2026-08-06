import * as m from '$lib/i18n/messages';

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
    icon: 'uil--shield-check',
    title: m['grades.templates.moderator.title'],
    description: m['grades.templates.moderator.description'],
    defaultName: 'moderation-team',
    defaultDisplayName: m['grades.templates.moderator.default_name'],
    defaultDescription: m['grades.templates.moderator.default_description'],
    defaultColor: '#16A34A',
    defaultPingable: true,
    permissions: MODERATOR_PERMISSIONS
  },
  {
    id: 'helper.v1',
    icon: 'uil--life-ring',
    title: m['grades.templates.helper.title'],
    description: m['grades.templates.helper.description'],
    defaultName: 'helpers',
    defaultDisplayName: m['grades.templates.helper.default_name'],
    defaultDescription: m['grades.templates.helper.default_description'],
    defaultColor: '#0891B2',
    defaultPingable: true,
    permissions: []
  },
  {
    id: 'custom',
    icon: 'uil--sliders-v-alt',
    title: m['grades.templates.custom.title'],
    description: m['grades.templates.custom.description'],
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
