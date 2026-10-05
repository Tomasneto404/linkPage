// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Signing in through an OpenID Connect provider — Authentik, or any other.
 *
 * The authorization code flow, with PKCE, a state value bound to the browser by
 * a cookie, and a nonce bound to the ID token. Nothing the provider returns is
 * believed until its signature checks out against the provider's published
 * keys and its issuer, audience, expiry and nonce are all what they must be.
 *
 * Written against the specification rather than a library. The part that
 * matters — verifying a signed JWT — is a few dozen lines on node:crypto, and a
 * dependency here would be the one place in the app where the code deciding
 * who someone is was not in this repository.
 *
 * The provider is configured by an administrator and usually lives on the same
 * private network as this server, so these requests deliberately do not go
 * through the network guard that keeps members' favicon fetches off it.
 */

const crypto = require('node:crypto');

const db = require('../models');

const FETCH_TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_TTL_MS      = 60 * 60 * 1000;
const JWKS_REFETCH_MS  = 60 * 1000;        // at most once a minute on an unknown key
const CLOCK_SKEW_S     = 60;
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;   // from leaving for the provider to coming back

const DEFAULT_LABEL = 'Sign in with single sign-on';

// ─── Configuration ────────────────────────────────────────────────────────────

/** The stored settings, read fresh: they change from the admin panel at runtime. */
function readConfig() {
  return {
    enabled:      db.readSetting('oidc_enabled') === '1',
    issuer:       db.readSetting('oidc_issuer') || '',
    clientId:     db.readSetting('oidc_client_id') || '',
    clientSecret: db.readSetting('oidc_client_secret') || '',
    label:        db.readSetting('oidc_label') || DEFAULT_LABEL,
    autoCreate:   db.readSetting('oidc_auto_create') === '1',
    linkByEmail:  db.readSetting('oidc_link_by_email') === '1',
  };
}

const isReady = cfg => cfg.enabled && !!cfg.issuer && !!cfg.clientId;

/** An issuer as typed into the admin panel, or null when it cannot be one. */
function normalizeIssuer(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return trimmed;
}

const sameIssuer = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

// ─── Talking to the provider ──────────────────────────────────────────────────

class OidcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function fetchJson(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    throw new OidcError('unreachable', `Could not reach ${new URL(url).host}: ${err.cause?.code || err.message}`);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const detail = body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new OidcError('provider_error', `${new URL(url).pathname} answered ${detail}`);
  }
  if (!body || typeof body !== 'object') {
    throw new OidcError('provider_error', `${new URL(url).pathname} did not answer with JSON`);
  }
  return body;
}

const discoveryCache = new Map();   // issuer → { at, meta }
const jwksCache      = new Map();   // jwks_uri → { at, keys }

/**
 * The provider's own description of itself. Its issuer must be the one that
 * was configured — a discovery document naming a different issuer is either a
 * misconfiguration or somebody else's provider.
 */
async function discover(issuer, { fresh = false } = {}) {
  const cached = discoveryCache.get(issuer);
  if (!fresh && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.meta;

  const url  = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const meta = await fetchJson(url);

  if (typeof meta.issuer !== 'string' || !sameIssuer(meta.issuer, issuer)) {
    throw new OidcError('bad_discovery', `The provider calls itself ${meta.issuer || 'nothing'}, not ${issuer}`);
  }
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof meta[field] !== 'string') {
      throw new OidcError('bad_discovery', `The provider's discovery document has no ${field}`);
    }
  }
  if (Array.isArray(meta.code_challenge_methods_supported)
      && !meta.code_challenge_methods_supported.includes('S256')) {
    throw new OidcError('bad_discovery', 'The provider does not support PKCE with S256');
  }

  discoveryCache.set(issuer, { at: Date.now(), meta });
  return meta;
}

async function fetchKeys(jwksUri) {
  const body = await fetchJson(jwksUri);
  if (!Array.isArray(body.keys)) throw new OidcError('bad_keys', 'The provider published no keys');
  jwksCache.set(jwksUri, { at: Date.now(), keys: body.keys });
  return body.keys;
}

/**
 * The provider's signing keys. Fetched again when a token names a key we have
 * not seen — providers rotate keys — but not more than once a minute, so a
 * stream of tokens naming made-up keys cannot turn this server into a client
 * hammering the provider.
 */
async function keysFor(meta, kid) {
  const cached = jwksCache.get(meta.jwks_uri);
  const stale  = !cached || Date.now() - cached.at > JWKS_TTL_MS;
  let keys = stale ? await fetchKeys(meta.jwks_uri) : cached.keys;

  const known = kid == null || keys.some(k => k.kid === kid);
  if (!known && !stale && Date.now() - cached.at > JWKS_REFETCH_MS) keys = await fetchKeys(meta.jwks_uri);
  return keys;
}

// ─── Verifying an ID token ────────────────────────────────────────────────────

const ALGORITHMS = {
  RS256: { kty: 'RSA', hash: 'sha256' },
  RS384: { kty: 'RSA', hash: 'sha384' },
  RS512: { kty: 'RSA', hash: 'sha512' },
  PS256: { kty: 'RSA', hash: 'sha256', pss: true },
  PS384: { kty: 'RSA', hash: 'sha384', pss: true },
  PS512: { kty: 'RSA', hash: 'sha512', pss: true },
  ES256: { kty: 'EC',  hash: 'sha256', crv: 'P-256' },
  ES384: { kty: 'EC',  hash: 'sha384', crv: 'P-384' },
  ES512: { kty: 'EC',  hash: 'sha512', crv: 'P-521' },
  EdDSA: { kty: 'OKP', hash: null },
  // Signed with the client secret. Allowed because Authentik does exactly
  // this when no signing key is chosen for the provider; only ever with a
  // secret, which is the one thing a public client has no way to know.
  HS256: { kty: 'oct', hash: 'sha256' },
  HS384: { kty: 'oct', hash: 'sha384' },
  HS512: { kty: 'oct', hash: 'sha512' },
};

function decodeSegment(segment, what) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new OidcError('bad_token', `The ID token's ${what} is not readable`);
  }
}

function checkSignature({ alg, spec, signingInput, signature, keys, kid, clientSecret }) {
  if (spec.kty === 'oct') {
    if (!clientSecret) throw new OidcError('bad_token', `${alg} needs a client secret, and none is configured`);
    const expected = crypto.createHmac(spec.hash, clientSecret).update(signingInput).digest();
    return expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
  }

  const candidates = keys.filter(k =>
    k.kty === spec.kty
    && (k.use == null || k.use === 'sig')
    && (k.alg == null || k.alg === alg)
    && (spec.crv == null || k.crv === spec.crv)
    && (kid == null || k.kid === kid));
  if (candidates.length === 0) throw new OidcError('bad_token', 'No published key matches the ID token');

  for (const jwk of candidates) {
    let key;
    try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { continue; }
    const options = { key };
    if (spec.pss) {
      options.padding    = crypto.constants.RSA_PKCS1_PSS_PADDING;
      options.saltLength = crypto.constants.RSA_PSS_SALTLEN_DIGEST;
    }
    if (spec.kty === 'EC') options.dsaEncoding = 'ieee-p1363';
    if (crypto.verify(spec.hash, Buffer.from(signingInput), options, signature)) return true;
  }
  return false;
}

/**
 * Checks an ID token and returns its claims. Throws on anything short of
 * perfect: the claims are only worth reading once every check has passed.
 */
async function verifyIdToken(idToken, { meta, clientId, clientSecret, nonce, now = Date.now() }) {
  if (typeof idToken !== 'string') throw new OidcError('bad_token', 'The provider sent no ID token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('bad_token', 'The ID token is not a signed JWT');

  const header = decodeSegment(parts[0], 'header');
  const claims = decodeSegment(parts[1], 'claims');
  const alg    = header.alg;
  // An own-property check, so "constructor" or "toString" is not mistaken for an algorithm.
  const spec   = Object.prototype.hasOwnProperty.call(ALGORITHMS, alg) ? ALGORITHMS[alg] : null;
  // 'none' is absent from the table, and so refused along with everything else unknown.
  if (!spec) throw new OidcError('bad_token', `The ID token is signed with ${alg || 'nothing'}, which is not accepted`);

  const keys = spec.kty === 'oct' ? [] : await keysFor(meta, header.kid);
  const ok = checkSignature({
    alg, spec, keys, kid: header.kid, clientSecret,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature:    Buffer.from(parts[2], 'base64url'),
  });
  if (!ok) throw new OidcError('bad_token', 'The ID token signature does not check out');

  const nowS = Math.floor(now / 1000);
  if (claims.iss !== meta.issuer) throw new OidcError('bad_token', 'The ID token is from a different issuer');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) throw new OidcError('bad_token', 'The ID token is for a different client');
  if ((audiences.length > 1 || claims.azp != null) && claims.azp !== clientId) {
    throw new OidcError('bad_token', 'The ID token was issued to a different client');
  }

  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) {
    throw new OidcError('bad_token', 'The ID token has expired');
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) {
    throw new OidcError('bad_token', 'The ID token was issued in the future');
  }
  if (typeof nonce !== 'string' || claims.nonce !== nonce) {
    throw new OidcError('bad_token', 'The ID token does not belong to this sign-in');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 255) {
    throw new OidcError('bad_token', 'The ID token names nobody');
  }
  return claims;
}

// ─── The flow ─────────────────────────────────────────────────────────────────

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const sha256      = value => crypto.createHash('sha256').update(value).digest();
const hashState   = state => sha256(state).toString('hex');

/**
 * Starts a sign-in: remembers what the return trip will need, and builds the
 * address to send the browser to. The caller sets the state cookie.
 */
async function beginLogin({ redirectUri, nextPath, linkUserId = null }) {
  const cfg  = readConfig();
  if (!isReady(cfg)) throw new OidcError('disabled', 'Single sign-on is not set up');
  const meta = await discover(cfg.issuer);

  const state        = randomToken();
  const nonce        = randomToken();
  const codeVerifier = randomToken();

  db.deleteStaleOidcLogins(LOGIN_MAX_AGE_MS);
  db.createOidcLogin({ stateHash: hashState(state), nonce, codeVerifier, redirectUri, nextPath, linkUserId });

  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', sha256(codeVerifier).toString('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.href, state };
}

/** Trades the code for tokens, authenticating as this client however the provider prefers. */
async function exchangeCode({ meta, cfg, code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

  const methods = meta.token_endpoint_auth_methods_supported || ['client_secret_basic'];
  if (cfg.clientSecret && methods.includes('client_secret_basic')) {
    const enc = encodeURIComponent;
    headers.Authorization = `Basic ${Buffer.from(`${enc(cfg.clientId)}:${enc(cfg.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', cfg.clientId);
    if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  }
  return fetchJson(meta.token_endpoint, { method: 'POST', headers, body });
}

/**
 * Fills in an address from the userinfo endpoint when the ID token left it out.
 * Its subject must match the token's, or it describes somebody else.
 */
async function withUserInfo(claims, meta, accessToken) {
  if (claims.email || !meta.userinfo_endpoint || !accessToken) return claims;
  try {
    const info = await fetchJson(meta.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (info.sub !== claims.sub) return claims;
    return { ...claims, email: info.email, email_verified: info.email_verified,
             name: claims.name ?? info.name, preferred_username: claims.preferred_username ?? info.preferred_username };
  } catch {
    return claims;
  }
}

/**
 * Finishes a sign-in: checks the state against the browser's cookie, trades
 * the code, verifies what comes back, and works out which account it is.
 *
 * Returns { user, login, created, linked } or throws an OidcError whose code
 * the sign-in page turns into a message.
 */
async function completeLogin({ state, cookieState, code, sessionUserId = null }) {
  // The cookie is what ties this return trip to the browser that set off. Without
  // it, someone could send a victim back here with the attacker's own code and
  // the victim would be signed in as the attacker, quietly saving their links
  // into the attacker's account.
  if (typeof state !== 'string' || !state || typeof cookieState !== 'string'
      || state.length !== cookieState.length
      || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    throw new OidcError('expired', 'This sign-in did not start in this browser');
  }
  const login = db.takeOidcLogin(hashState(state), LOGIN_MAX_AGE_MS);
  if (!login) throw new OidcError('expired', 'This sign-in has expired or was already used');

  // From here on the caller knows where the person was headed, and whether they
  // were connecting an account rather than signing in, so a failure can send
  // them back to the right place.
  try {
    if (typeof code !== 'string' || !code) throw new OidcError('failed', 'The provider sent no code');

    const cfg = readConfig();
    if (!isReady(cfg)) throw new OidcError('disabled', 'Single sign-on is not set up');
    const meta = await discover(cfg.issuer);

    const tokens = await exchangeCode({ meta, cfg, code, redirectUri: login.redirect_uri,
                                        codeVerifier: login.code_verifier });
    let claims = await verifyIdToken(tokens.id_token, {
      meta, clientId: cfg.clientId, clientSecret: cfg.clientSecret, nonce: login.nonce,
    });
    claims = await withUserInfo(claims, meta, tokens.access_token);

    const account = resolveAccount({ claims, cfg, provider: meta.issuer,
                                     linkUserId: login.link_user_id, sessionUserId });
    return { ...account, login, claims };
  } catch (err) {
    err.connecting = !!login.link_user_id;
    err.nextPath   = login.next_path;
    throw err;
  }
}

/**
 * Which account a verified identity belongs to, linking or creating one when
 * the settings allow. In order:
 *
 *   1. one already linked to this subject at this issuer;
 *   2. the signed-in member who set off to connect their account;
 *   3. an account with the same address, if linking by address is on and the
 *      provider says it checked the address;
 *   4. a new account, if creating them is on.
 *
 * The provider's word that an address is verified is required for (3), because
 * without it anyone who can set their own address at the provider — Authentik
 * lets users edit theirs by default — could claim any account here, the
 * administrator's included.
 */
function resolveAccount({ claims, cfg, provider, linkUserId, sessionUserId }) {
  const email = typeof claims.email === 'string' && db.isValidEmail(claims.email) ? claims.email.trim() : null;
  const existing = db.getIdentity(provider, claims.sub);

  if (linkUserId) {
    if (linkUserId !== sessionUserId) throw new OidcError('expired', 'You were signed out before this finished');
    if (existing && existing.user_id !== linkUserId) {
      throw new OidcError('already_linked', 'That sign-in is already connected to another account here');
    }
    if (!existing) db.linkIdentity({ userId: linkUserId, provider, subject: claims.sub, email });
    else db.touchIdentity(existing.id, email);
    return { user: db.getUserById(linkUserId), linked: !existing, created: false, connecting: true };
  }

  if (existing) {
    const user = db.getUserById(existing.user_id);
    if (!user) throw new OidcError('no_account', 'No account here for this sign-in');
    if (!user.is_active) throw new OidcError('disabled', 'This account is disabled');
    db.touchIdentity(existing.id, email);
    return { user, linked: false, created: false };
  }

  const byEmail = email ? db.getUserByEmail(email) : null;

  if (byEmail && cfg.linkByEmail && claims.email_verified === true) {
    if (!byEmail.is_active) throw new OidcError('disabled', 'This account is disabled');
    if (db.getIdentitiesForUser(byEmail.id).some(i => i.provider === provider)) {
      throw new OidcError('already_linked', 'That account is already connected to a different sign-in');
    }
    db.linkIdentity({ userId: byEmail.id, provider, subject: claims.sub, email });
    return { user: byEmail, linked: true, created: false };
  }

  if (cfg.autoCreate) {
    if (!email) throw new OidcError('no_email', 'The provider did not share an email address');
    if (byEmail) throw new OidcError('email_taken', 'An account with this address already exists here');
    const displayName = [claims.name, claims.preferred_username]
      .find(v => typeof v === 'string' && v.trim())?.trim().slice(0, 100) || null;
    const user = db.createUser({ email, displayName, role: 'user' });
    db.linkIdentity({ userId: user.id, provider, subject: claims.sub, email });
    return { user, linked: true, created: true };
  }

  throw new OidcError('no_account', 'No account here for this sign-in');
}

/** Forgets cached provider documents. For tests, and after the settings change. */
function resetCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

module.exports = {
  DEFAULT_LABEL, LOGIN_MAX_AGE_MS,
  OidcError, readConfig, isReady, normalizeIssuer,
  discover, verifyIdToken, beginLogin, completeLogin, resetCaches,
};
