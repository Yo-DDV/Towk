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
    throw new Error('Invalid OAuth server URL.');
  }
  return url;
}

export function buildServerOAuthAuthorizeUrl(
  serverUrl: string,
  authorizeUrl: string,
  parameters: OAuthAuthorizeParameters
): string {
  if (!authorizeUrl.trim()) {
    throw new Error('Invalid OAuth authorization endpoint.');
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
    throw new Error('Invalid OAuth authorization endpoint.');
  }

  for (const [name, value] of Object.entries(parameters)) {
    authorize.searchParams.set(name, value);
  }
  return authorize.toString();
}
