import deCatalog from '../../../messages/de/room_purge.json';
import enCatalog from '../../../messages/en/room_purge.json';
import esCatalog from '../../../messages/es/room_purge.json';
import frCatalog from '../../../messages/fr/room_purge.json';
import ptCatalog from '../../../messages/pt/room_purge.json';
import { getReactiveLocale } from './state.svelte';

type Catalog = typeof enCatalog.room_purge;
type CatalogKey = keyof Catalog;
type Inputs = Record<string, string | number>;

const catalogs: Record<'en' | 'de' | 'fr' | 'es' | 'pt', Catalog> = {
  en: enCatalog.room_purge,
  de: deCatalog.room_purge,
  fr: frCatalog.room_purge,
  es: esCatalog.room_purge,
  pt: ptCatalog.room_purge
};

function catalog(): Catalog {
  const locale = getReactiveLocale();
  return catalogs[locale as keyof typeof catalogs] ?? catalogs.en;
}

function message(key: CatalogKey, inputs: Inputs = {}): string {
  let value: string = catalog()[key];
  for (const [name, replacement] of Object.entries(inputs)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export const roomPurgeMessages = {
  panelTitle: () => message('panel_title'),
  panelSubtitle: () => message('panel_subtitle'),
  capabilityUnavailable: () => message('capability_unavailable'),
  noArchivedRooms: () => message('no_archived_rooms'),
  deleteAction: () => message('delete_action'),
  actionAria: (room: string) => message('action_aria', { room }),
  dialogTitle: (room: string) => message('dialog_title', { room }),
  irreversibleTitle: () => message('irreversible_title'),
  irreversibleBody: () => message('irreversible_body'),
  removesMessages: () => message('removes_messages'),
  removesThreadsReactions: () => message('removes_threads_reactions'),
  removesFilesCalls: () => message('removes_files_calls'),
  removesAccess: () => message('removes_access'),
  backupNotice: () => message('backup_notice'),
  confirmationLabel: () => message('confirmation_label'),
  confirmationDescription: (room: string) => message('confirmation_description', { room }),
  confirmationPlaceholder: (room: string) => message('confirmation_placeholder', { room }),
  confirmationError: (room: string) => message('confirmation_error', { room }),
  submit: () => message('submit'),
  submitting: () => message('submitting'),
  retryLocal: () => message('retry_local'),
  localCleanupError: () => message('local_cleanup_error'),
  success: (room: string) => message('success', { room }),
  alreadyPurged: (room: string) => message('already_purged', { room }),
  retryHint: (seconds: number) => message('retry_hint', { seconds }),
  errorAuthenticationRequired: () => message('error_authentication_required'),
  errorAuthenticationUnavailable: () => message('error_authentication_unavailable'),
  errorForbidden: () => message('error_forbidden'),
  errorInvalidRoomID: () => message('error_invalid_room_id'),
  errorConfirmationMismatch: () => message('error_confirmation_mismatch'),
  errorRoomNotArchived: () => message('error_room_not_archived'),
  errorPurgeInProgress: () => message('error_purge_in_progress'),
  errorPurgeNotQuiescent: () => message('error_purge_not_quiescent'),
  errorRoomNotFound: () => message('error_room_not_found'),
  errorTimedOut: () => message('error_timed_out'),
  errorInterrupted: () => message('error_interrupted'),
  errorTemporarilyUnavailable: () => message('error_temporarily_unavailable'),
  errorInvalidRequest: () => message('error_invalid_request'),
  errorInvalidResponse: () => message('error_invalid_response'),
  errorNetwork: () => message('error_network'),
  errorInternal: () => message('error_internal')
};
