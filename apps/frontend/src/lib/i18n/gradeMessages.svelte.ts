import en from '../../../messages/en/grades.json';
import de from '../../../messages/de/grades.json';
import fr from '../../../messages/fr/grades.json';
import es from '../../../messages/es/grades.json';
import pt from '../../../messages/pt/grades.json';
import { getReactiveLocale } from './state.svelte';

type Catalog = typeof en.grades;
type GradeLocale = 'en' | 'de' | 'fr' | 'es' | 'pt';

const catalogs: Record<GradeLocale, Catalog> = {
  en: en.grades,
  de: de.grades as Catalog,
  fr: fr.grades as Catalog,
  es: es.grades as Catalog,
  pt: pt.grades as Catalog
};

function current(): Catalog {
  const locale = getReactiveLocale();
  return catalogs[locale as GradeLocale] ?? catalogs.en;
}

function handlePreview(handle: string): string {
  return current().create.handle_preview.replace('{handle}', handle);
}

export const g = {
  'grades.system_roles.helper.display_name': () => current().system_roles.helper.display_name,
  'grades.system_roles.helper.description': () => current().system_roles.helper.description,

  'grades.templates.moderator.title': () => current().templates.moderator.title,
  'grades.templates.moderator.description': () => current().templates.moderator.description,
  'grades.templates.moderator.default_name': () => current().templates.moderator.default_name,
  'grades.templates.moderator.default_description': () =>
    current().templates.moderator.default_description,
  'grades.templates.helper.title': () => current().templates.helper.title,
  'grades.templates.helper.description': () => current().templates.helper.description,
  'grades.templates.helper.default_name': () => current().templates.helper.default_name,
  'grades.templates.helper.default_description': () => current().templates.helper.default_description,
  'grades.templates.custom.title': () => current().templates.custom.title,
  'grades.templates.custom.description': () => current().templates.custom.description,

  'grades.permission_descriptions.room_remove_member': () =>
    current().permission_descriptions.room_remove_member,
  'grades.permission_descriptions.room_lock': () => current().permission_descriptions.room_lock,
  'grades.permission_descriptions.room_purge_messages': () =>
    current().permission_descriptions.room_purge_messages,
  'grades.permission_descriptions.room_bypass_lock': () =>
    current().permission_descriptions.room_bypass_lock,
  'grades.permission_descriptions.message_delete_others': () =>
    current().permission_descriptions.message_delete_others,

  'grades.create.title': () => current().create.title,
  'grades.create.subtitle': () => current().create.subtitle,
  'grades.create.starting_point': () => current().create.starting_point,
  'grades.create.starting_point_description': () => current().create.starting_point_description,
  'grades.create.identity': () => current().create.identity,
  'grades.create.permissions': () => current().create.permissions,
  'grades.create.added_permissions': () => current().create.added_permissions,
  'grades.create.inherited_permissions': () => current().create.inherited_permissions,
  'grades.create.no_added_permissions': () => current().create.no_added_permissions,
  'grades.create.advanced': () => current().create.advanced,
  'grades.create.advanced_description': () => current().create.advanced_description,
  'grades.create.create': () => current().create.create,
  'grades.create.creating': () => current().create.creating,
  'grades.create.permission_setup_failed': () => current().create.permission_setup_failed,
  'grades.create.template_changed': () => current().create.template_changed,
  'grades.create.handle_preview': ({ handle }: { handle: string }) => handlePreview(handle),
  'grades.create.member_inheritance_note': () => current().create.member_inheritance_note,

  'grades.overview.title': () => current().overview.title,
  'grades.overview.subtitle': () => current().overview.subtitle,
  'grades.overview.default_grades': () => current().overview.default_grades,
  'grades.overview.advanced_admin': () => current().overview.advanced_admin,
  'grades.overview.custom_grades': () => current().overview.custom_grades,
  'grades.overview.helper_summary': () => current().overview.helper_summary,
  'grades.overview.moderator_summary': () => current().overview.moderator_summary,
  'grades.overview.members_summary': () => current().overview.members_summary,
  'grades.overview.owner_summary': () => current().overview.owner_summary,
  'grades.overview.admin_summary': () => current().overview.admin_summary,

  'grades.risk.standard': () => current().risk.standard,
  'grades.risk.moderation': () => current().risk.moderation,
  'grades.risk.sensitive': () => current().risk.sensitive,
  'grades.risk.destructive': () => current().risk.destructive,
  'grades.risk.privilege': () => current().risk.privilege,
  'grades.risk.legacy': () => current().risk.legacy
} as const;
