// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Who the server thinks a request came from.
 *
 * The client IP is not cosmetic: it is what every rate limiter counts and what
 * the audit log records against an action. X-Forwarded-For is a header the
 * client writes, so it is only worth anything when something trustworthy sits
 * in front of us and overwrites it — which is what TRUST_PROXY says.
 *
 * The default is to trust one hop, matching the shipped docker-compose and the
 * behaviour the app already had. This file pins both halves: that the default
 * still reads the header, and that TRUST_PROXY=0 stops reading it.
 *
 * The parser is exercised in-process; the end-to-end half runs in a child, so
 * one file can see both settings (src/config/env.js resolves at import time).
 */

const { execFileSync } = require('node:child_process');
const path   = require('node:path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const SRC = path.join(__dirname, '..', 'src');

/** Boots the app with a given TRUST_PROXY and reports the IP it sees. */
function clientIpWith(trustProxy, forwardedFor) {
  const script = `
    process.env.TRUST_PROXY = ${JSON.stringify(String(trustProxy))};
    const { getClientIp } = require(${JSON.stringify(path.join(SRC, 'utils', 'http'))});
    const req = {
      headers: { 'x-forwarded-for': ${JSON.stringify(forwardedFor)} },
      socket:  { remoteAddress: '10.0.0.7' },
      ip:      '10.0.0.7',
    };
    process.stdout.write(getClientIp(req));
  `;
  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

describe('the forwarded-for header', () => {
  test('is read by default, because the app ships behind a proxy', () => {
    assert.equal(clientIpWith('', '203.0.113.9'), '203.0.113.9');
    assert.equal(clientIpWith('1', '203.0.113.9'), '203.0.113.9');
  });

  test('is ignored when nothing is trusted in front of us', () => {
    // Without this, a caller picks its own identity for the rate limiters and
    // writes whatever it likes into the audit log's ip_address.
    assert.equal(clientIpWith('0', '203.0.113.9'), '10.0.0.7');
    assert.equal(clientIpWith('false', '203.0.113.9'), '10.0.0.7');
  });

  test('only the first hop is taken, not the whole chain', () => {
    assert.equal(clientIpWith('1', '203.0.113.9, 70.41.3.18, 150.172.238.178'), '203.0.113.9');
  });

  test('the socket address is the fallback when the header is absent', () => {
    assert.equal(clientIpWith('1', ''), '10.0.0.7');
  });
});

describe('the setting itself', () => {
  const parsed = value => {
    const script = `
      process.env.TRUST_PROXY = ${JSON.stringify(String(value))};
      const { TRUST_PROXY } = require(${JSON.stringify(path.join(SRC, 'config', 'env'))});
      process.stdout.write(JSON.stringify(TRUST_PROXY));
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
  };

  test('unset means one hop', () => {
    assert.equal(parsed(''), 1);
  });

  test('the ways of saying no all mean no', () => {
    for (const value of ['0', 'false', 'off', 'no', 'FALSE']) {
      assert.equal(parsed(value), false, `${value} should disable it`);
    }
  });

  test('a hop count comes through as a number', () => {
    assert.equal(parsed('2'), 2);
  });

  test('anything Express understands is passed straight through', () => {
    assert.equal(parsed('loopback'), 'loopback');
    assert.equal(parsed('10.0.0.0/8'), '10.0.0.0/8');
  });
});

describe('end to end, on the running app', () => {
  test('a forwarded address is what the audit log records', async () => {
    const group = await c.makeGroup({ name: 'Proxied' });
    await c.api(`/api/groups/${group.id}`, {
      method: 'PUT',
      json:   { name: 'Proxied twice', color: group.color },
      headers: { 'X-Forwarded-For': '198.51.100.23' },
    });

    const log = await c.api('/api/audit?limit=5');
    const entry = log.body.entries.find(e => e.action === 'group.update');
    assert.ok(entry, 'the update was logged');
    assert.equal(entry.ip_address, '198.51.100.23');
  });
});
