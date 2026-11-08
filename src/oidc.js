// OpenID Connect (authorization code + PKCE + state + nonce) against the configured issuer.
import * as client from 'openid-client';

export function createOidc({ issuer, clientId, clientSecret, redirectUri, execute = [] }) {
  let discovered = null;

  async function configuration() {
    // Cached only on success, so a temporarily unreachable issuer does not need a restart.
    discovered ??= await client.discovery(new URL(issuer), clientId, clientSecret, undefined, { execute });
    return discovered;
  }

  return {
    async authorizationUrl({ state, nonce, codeVerifier }) {
      const config = await configuration();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      return client
        .buildAuthorizationUrl(config, {
          redirect_uri: redirectUri,
          scope: 'openid profile email',
          response_type: 'code',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          nonce,
        })
        .toString();
    },

    /** Exchanges the code and returns verified identity claims. Throws on any mismatch. */
    async redeem({ callbackUrl, state, nonce, codeVerifier }) {
      const config = await configuration();
      const tokens = await client.authorizationCodeGrant(config, new URL(callbackUrl), {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      let groups = claims.groups;
      if (!Array.isArray(groups)) {
        const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
        groups = Array.isArray(info.groups) ? info.groups : [];
      }
      return { sub: claims.sub, username: claims.preferred_username ?? claims.sub, groups };
    },
  };
}
