// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A small OpenID Connect provider, in process, for the single sign-on tests.
 *
 * Shaped like Authentik: the issuer is a path under the host with a trailing
 * slash, and the token endpoint takes client_secret_basic. It does what a real
 * provider does at each step and checks what a real one checks — PKCE, the
 * redirect URI, the client's credentials, one use per code — so a client that
 * skips any of those fails here as it would against the real thing.
 *
 * The browser's visit to the authorization endpoint is played by approve():
 * given the address the app redirected to, it returns the code the provider
 * would have sent back. Its `tamper` option mints the ID tokens a hostile or
 * broken provider would, for the tests that must see them refused.
 */

const http   = require('node:http');
const crypto = require('node:crypto');

async function startFakeOidc({ clientId = 'linkpage', clientSecret = 'provider-secret' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', use: 'sig', alg: 'RS256' };

  const codes  = new Map();   // code → { params, user, tamper, used }
  const tokenRequests = [];
  let base, issuer;

  const sign = (header, claims, key = privateKey) => {
    const enc  = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const input = `${enc(header)}.${enc(claims)}`;
    if (header.alg === 'none') return `${input}.`;
    if (header.alg.startsWith('HS')) {
      return `${input}.${crypto.createHmac('sha256', clientSecret).update(input).digest('base64url')}`;
    }
    return `${input}.${crypto.sign('sha256', Buffer.from(input), key).toString('base64url')}`;
  };

  function idTokenFor(entry) {
    const { params, user, tamper = {} } = entry;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer, aud: clientId, sub: user.sub, nonce: params.get('nonce'),
      iat: now, exp: now + 300,
      ...(user.email !== undefined ? { email: user.email } : {}),
      email_verified: user.email_verified ?? true,
      name: user.name, preferred_username: user.preferred_username,
      ...(tamper.claims || {}),
    };
    const header = { alg: tamper.alg || 'RS256', kid: tamper.kid ?? 'key-1', typ: 'JWT' };
    const key = tamper.signWith || privateKey;
    let token = sign(header, claims, key);
    if (tamper.alterClaims) {
      // Swap the claims after signing: a valid signature over different claims.
      const parts = token.split('.');
      parts[1] = Buffer.from(JSON.stringify({ ...claims, ...tamper.alterClaims })).toString('base64url');
      token = parts.join('.');
    }
    return token;
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const path = url.pathname;

    if (path === new URL('.well-known/openid-configuration', issuer).pathname) {
      return send(res, 200, {
        issuer,
        authorization_endpoint: `${base}/application/o/authorize/`,
        token_endpoint:         `${base}/application/o/token/`,
        userinfo_endpoint:      `${base}/application/o/userinfo/`,
        jwks_uri:               `${issuer}jwks/`,
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        code_challenge_methods_supported: ['plain', 'S256'],
      });
    }
    if (path === new URL('jwks/', issuer).pathname) return send(res, 200, { keys: [jwk] });

    if (path === '/application/o/token/' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      tokenRequests.push({ form, authorization: req.headers.authorization || null });

      const basic = (req.headers.authorization || '').match(/^Basic (.+)$/);
      const [id, secret] = basic
        ? Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent)
        : [form.get('client_id'), form.get('client_secret')];
      if (id !== clientId || secret !== clientSecret) return send(res, 401, { error: 'invalid_client' });

      const entry = codes.get(form.get('code'));
      if (!entry || entry.used) return send(res, 400, { error: 'invalid_grant' });
      entry.used = true;
      if (form.get('redirect_uri') !== entry.params.get('redirect_uri')) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }
      const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (entry.params.get('code_challenge_method') !== 'S256' || challenge !== entry.params.get('code_challenge')) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
      return send(res, 200, {
        access_token: `at-${form.get('code')}`, token_type: 'Bearer', expires_in: 300,
        id_token: idTokenFor(entry),
      });
    }

    if (path === '/application/o/userinfo/') {
      const code = (req.headers.authorization || '').replace(/^Bearer at-/, '');
      const entry = codes.get(code);
      if (!entry) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, { sub: entry.user.sub, ...(entry.user.userinfo || {}) });
    }

    send(res, 404, { error: 'not_found' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base   = `http://127.0.0.1:${server.address().port}`;
  issuer = `${base}/application/o/linkpage/`;

  return {
    clientId, clientSecret,
    get issuer() { return issuer; },
    tokenRequests,

    /**
     * Plays the person approving the sign-in at the provider. Takes the address
     * the app redirected to and returns the code the provider would send back.
     */
    approve(authorizeUrl, user, { tamper } = {}) {
      const params = new URL(authorizeUrl).searchParams;
      if (params.get('client_id') !== clientId) throw new Error('fake OIDC: wrong client_id');
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { params, user, tamper, used: false });
      return code;
    },

    /** A key of nobody's, for signatures that must not verify. */
    strangerKey: () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,

    stop: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

module.exports = { startFakeOidc };
