import { createPublicTowkClient } from './connect.js';
import { ServerDiscoveryService } from '@towk/api-types/chatto/discovery/v1/server_pb';
import { mapServerProfile } from './serverProfile.js';
import * as m from '$lib/i18n/messages';

export type PublicAuthProvider = {
  id: string;
  type: string;
  label: string;
  loginUrl: string;
};

export type PublicServerInfo = {
  name: string;
  version: string;
  authorizeUrl: string;
  directRegistrationEnabled: boolean;
  welcomeMessage: string | null;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  capabilities: string[];
  authProviders: PublicAuthProvider[];
};

export async function getPublicServerInfo(
  baseUrl: string,
  options: { signal?: AbortSignal } = {}
): Promise<PublicServerInfo> {
  const client = createPublicTowkClient(ServerDiscoveryService, baseUrl);
  const response = await client.getServer({}, { signal: options.signal });
  if (!response.profile?.name) {
    throw new Error(m['add_server.not_chatto_server']());
  }
  const profile = mapServerProfile(response.profile);

  return {
    name: profile.name,
    version: profile.version,
    authorizeUrl: response.login?.authorizeUrl ?? '',
    directRegistrationEnabled: response.login?.directRegistrationEnabled ?? false,
    welcomeMessage: profile.welcomeMessage,
    description: profile.description,
    iconUrl: profile.logoUrl,
    bannerUrl: profile.bannerUrl,
    capabilities: [...(response.profile.capabilities ?? [])],
    authProviders: (response.login?.providers ?? []).map((provider) => ({
      id: provider.id,
      type: provider.type,
      label: provider.label,
      loginUrl: provider.loginUrl
    }))
  };
}
