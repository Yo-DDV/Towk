import { describe, expect, it } from 'vitest';
import { buildServerOAuthAuthorizeUrl, type OAuthAuthorizeParameters } from './authorizeUrl';

const parameters: OAuthAuthorizeParameters = {
  response_type: 'code',
  redirect_uri: 'https://app.example/servers/callback',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  state: 'state'
};

describe('buildServerOAuthAuthorizeUrl', () => {
  it.each([
    ['/oauth/authorize', 'https://chat.example/oauth/authorize'],
    ['oauth/authorize', 'https://chat.example/oauth/authorize'],
    ['https://chat.example/oauth/authorize', 'https://chat.example/oauth/authorize'],
    ['/oauth/authorize?audience=towk', 'https://chat.example/oauth/authorize']
  ])('resolves a same-origin endpoint %s', (authorizeUrl, expectedBase) => {
    const result = new URL(
      buildServerOAuthAuthorizeUrl('https://chat.example/base/path', authorizeUrl, parameters)
    );

    expect(`${result.origin}${result.pathname}`).toBe(expectedBase);
    expect(result.searchParams.get('audience')).toBe(
      authorizeUrl.includes('audience') ? 'towk' : null
    );
    expect(result.searchParams.get('response_type')).toBe('code');
    expect(result.searchParams.get('redirect_uri')).toBe(parameters.redirect_uri);
    expect(result.searchParams.get('code_challenge')).toBe('challenge');
    expect(result.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.searchParams.get('state')).toBe('state');
  });

  it.each([
    '',
    '   ',
    '//evil.example/oauth/authorize',
    'https://evil.example/oauth/authorize',
    'https://chat.example.evil.example/oauth/authorize',
    'https://chat.example@evil.example/oauth/authorize',
    '\\\\evil.example/oauth/authorize',
    'javascript:alert(1)',
    'https://user@chat.example/oauth/authorize',
    '/oauth/authorize#https://evil.example'
  ])('rejects an unsafe endpoint %s', (authorizeUrl) => {
    expect(() =>
      buildServerOAuthAuthorizeUrl('https://chat.example', authorizeUrl, parameters)
    ).toThrow('Invalid OAuth authorization endpoint.');
  });

  it.each(['ftp://chat.example', 'javascript:alert(1)', 'https://user@chat.example', 'not a URL'])(
    'rejects an unsafe server URL %s',
    (serverUrl) => {
      expect(() =>
        buildServerOAuthAuthorizeUrl(serverUrl, '/oauth/authorize', parameters)
      ).toThrow();
    }
  );

  it('overwrites discovery-provided OAuth parameters', () => {
    const result = new URL(
      buildServerOAuthAuthorizeUrl(
        'https://chat.example',
        '/oauth/authorize?state=attacker&redirect_uri=https://evil.example',
        parameters
      )
    );

    expect(result.searchParams.get('state')).toBe('state');
    expect(result.searchParams.get('redirect_uri')).toBe(parameters.redirect_uri);
  });
});
