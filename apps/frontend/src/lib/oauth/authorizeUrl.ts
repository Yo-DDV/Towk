import * as m from '$lib/i18n/messages';

export type OAuthAuthorizeParameters = {
  response_type: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
};

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error(m['add_server.invalid_oauth_server_url']());
  }
  return url;
}

export function buildServerOAuthAuthorizeUrl(
  serverUrl: string,
  authorizeUrl: string,
  parameters: OAuthAuthorizeParameters
): string {
  if (!authorizeUrl.trim()) {
    throw new Error(m['add_server.invalid_oauth_authorization_endpoint']());
  }
  const server = parseHttpUrl(serverUrl);
  server.pathname = '/';
  server.search = '';
  server.hash = '';

  const authorize = new URL(authorizeUrl, server);
  if (
    authorize.origin !== server.origin ||
    authorize.username ||
    authorize.password ||
    authorize.hash
  ) {
    throw new Error(m['add_server.invalid_oauth_authorization_endpoint']());
  }

  for (const [name, value] of Object.entries(parameters)) {
    authorize.searchParams.set(name, value);
  }
  return authorize.toString();
}
