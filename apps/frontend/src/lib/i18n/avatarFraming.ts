import type { Locale } from '$lib/paraglide/runtime';
import { getReactiveLocale } from './state.svelte';
import de from '../../../messages/de/avatar-framing.json';
import en from '../../../messages/en/avatar-framing.json';
import es from '../../../messages/es/avatar-framing.json';
import fr from '../../../messages/fr/avatar-framing.json';
import pt from '../../../messages/pt/avatar-framing.json';

export type AvatarFramingMessages = typeof en;

export const avatarFramingCatalogs: Record<Locale, AvatarFramingMessages> = { de, en, es, fr, pt };

export function avatarFramingMessages(): AvatarFramingMessages {
  return avatarFramingCatalogs[getReactiveLocale()] ?? en;
}

export function formatAvatarFramingMessage(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{([a-z_]+)\}/gi, (_, key: string) => String(values[key] ?? `{${key}}`));
}
