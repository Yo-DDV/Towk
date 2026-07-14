import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { getPublicServerInfo, type PublicServerInfo } from '$lib/api-client/server';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  saveFlowState
} from '$lib/oauth/pkce';
import { buildServerOAuthAuthorizeUrl } from '$lib/oauth/authorizeUrl';
import { serverRegistry, type RegisteredServer } from '$lib/state/server/registry.svelte';
import { clearCachedUser } from './loadAuth';
import * as m from '$lib/i18n/messages';

export async function startServerOAuthFlow(
  serverUrl: string,
  serverInfo: Pick<PublicServerInfo, 'name' | 'authorizeUrl' | 'iconUrl'>
): Promise<void> {
  if (!serverInfo.authorizeUrl) {
    throw new Error(m['add_server.oauth_unsupported']());
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();
  const redirectUri = `${window.location.origin}/servers/callback`;

  const authorizeUrl = buildServerOAuthAuthorizeUrl(serverUrl, serverInfo.authorizeUrl, {
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });

  saveFlowState({
    verifier,
    state,
    remoteUrl: serverUrl,
    serverName: serverInfo.name,
    serverIconUrl: serverInfo.iconUrl ?? null
  });

  window.location.href = authorizeUrl;
}

export async function startRemoteReauthentication(server: RegisteredServer): Promise<void> {
  const info = await getPublicServerInfo(server.url, { signal: AbortSignal.timeout(10000) });
  await startServerOAuthFlow(server.url, {
    name: info.name || server.name,
    authorizeUrl: info.authorizeUrl,
    iconUrl: info.iconUrl ?? server.iconUrl
  });
}

export async function beginOriginReauthentication(): Promise<void> {
  const path = window.location.pathname + window.location.search;
  sessionStorage.setItem('returnUrl', path);
  clearCachedUser();
  await serverRegistry.clearOriginAuthentication();

  const redirect =
    resolve('/login') +
    '?' +
    new URLSearchParams({
      error: 'authentication_required',
      redirect: path
    });
  // eslint-disable-next-line svelte/no-navigation-without-resolve -- base route is resolved above; query parameters preserve the current app path
  void goto(redirect, { invalidateAll: true });
}
