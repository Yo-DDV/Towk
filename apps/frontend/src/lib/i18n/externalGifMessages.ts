import de from '../../../messages/de/external-gif.json';
import en from '../../../messages/en/external-gif.json';
import es from '../../../messages/es/external-gif.json';
import fr from '../../../messages/fr/external-gif.json';
import pt from '../../../messages/pt/external-gif.json';
import type { Locale } from '$lib/paraglide/runtime';
import { getReactiveLocale } from './state.svelte';

type ExternalGifCatalog = typeof en;

const catalogs: Record<Locale, ExternalGifCatalog> = { de, en, es, fr, pt };

function catalog(): ExternalGifCatalog {
  return catalogs[getReactiveLocale()] ?? en;
}

function withProvider(template: string, provider: string): string {
  return template.replace('{provider}', provider);
}

export const externalGifMessages = {
  load: () => catalog().room.external_gif.load,
  loading: () => catalog().room.external_gif.loading,
  loadFailed: () => catalog().room.external_gif.load_failed,
  offline: () => catalog().room.external_gif.offline,
  retry: () => catalog().room.external_gif.retry,
  hide: () => catalog().room.external_gif.hide,
  openSource: () => catalog().room.external_gif.open_source,
  privacyNotice: (provider: string) =>
    withProvider(catalog().room.external_gif.privacy_notice, provider),
  mediaTitle: (provider: string) => withProvider(catalog().room.external_gif.media_title, provider),
  settingsTitle: () => catalog().settings.preferences.external_gifs.title,
  settingsDescription: () => catalog().settings.preferences.external_gifs.description,
  settingsAutoLoadLabel: () => catalog().settings.preferences.external_gifs.auto_load.label,
  settingsAutoLoadDescription: () =>
    catalog().settings.preferences.external_gifs.auto_load.description
};
