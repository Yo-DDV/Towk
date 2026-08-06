import de from '../../../messages/de/profile-banner.json';
import en from '../../../messages/en/profile-banner.json';
import es from '../../../messages/es/profile-banner.json';
import fr from '../../../messages/fr/profile-banner.json';
import pt from '../../../messages/pt/profile-banner.json';
import { getReactiveLocale } from './state.svelte';

const catalogs = { de, en, es, fr, pt } as const;

export type ProfileBannerMessageKey = keyof typeof en;
type MessageValues = Record<string, string | number>;

export function profileBannerMessage(
  key: ProfileBannerMessageKey,
  values: MessageValues = {}
): string {
  const locale = getReactiveLocale();
  const catalog = catalogs[locale] ?? catalogs.en;
  const template = catalog[key] ?? catalogs.en[key];
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template
  );
}

export const profileBannerCatalogs = catalogs;
