import type { Locale } from '$lib/paraglide/runtime';
import { getReactiveLocale } from './state.svelte';
import en from '../../../messages/en/upload_progress.json';
import de from '../../../messages/de/upload_progress.json';
import fr from '../../../messages/fr/upload_progress.json';
import es from '../../../messages/es/upload_progress.json';
import pt from '../../../messages/pt/upload_progress.json';

type UploadProgressCatalog = typeof en.upload_progress;
export type UploadProgressMessageKey = keyof UploadProgressCatalog;

const catalogs: Record<Locale, UploadProgressCatalog> = {
  en: en.upload_progress,
  de: de.upload_progress,
  fr: fr.upload_progress,
  es: es.upload_progress,
  pt: pt.upload_progress
};

export function uploadProgressMessage(
  key: UploadProgressMessageKey,
  values: Record<string, string | number> = {}
): string {
  const catalog = catalogs[getReactiveLocale()] ?? catalogs.en;
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    catalog[key]
  );
}
