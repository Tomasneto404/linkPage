// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Keeps member-triggered fetches out of the server's own network.
 *
 * When a member saves a link, or asks to preview its icon, this server fetches
 * the address they typed. Without a guard that is a way to make the server send
 * requests anywhere it can reach — its own admin routes on localhost, a cloud
 * provider's metadata service at 169.254.169.254, a database on 10.0.0.5 — and,
 * when the answer happens to be image-shaped, to hand it back to them as their
 * link's icon.
 *
 * The check runs at the moment a socket is opened, not on the URL. That is the
 * only place it can be trusted:
 *
 *   - A URL check misses redirects. A public page can 302 to an internal one,
 *     and every hop opens a new connection; each one comes through here.
 *   - A URL check misses DNS. "intranet.example.com" can resolve to 10.0.0.5.
 *     Resolved here, every answer must be public — a name that resolves to one
 *     public and one private address is the shape of a rebinding attempt.
 *   - A URL check races DNS. Resolving once to validate and letting the HTTP
 *     client resolve again to connect leaves a window for the second answer to
 *     differ. The connection here goes to the exact address that was checked.
 *
 * The administrator's own shared links do not use this. Fetching an intranet
 * site's icon is the point of an internal link page, and the administrator is
 * the person who runs the network.
 */

const dns = require('node:dns');
const net = require('node:net');
const { Agent, buildConnector } = require('undici');

const blocked = new net.BlockList();

// IPv4. Everything not routable on the public internet, plus the ranges reserved
// for documentation and benchmarking, which nothing legitimate is served from.
for (const [address, prefix] of [
  ['0.0.0.0',       8],   // "this network"
  ['10.0.0.0',      8],   // private
  ['100.64.0.0',   10],   // carrier-grade NAT
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',  16],   // link-local — where cloud metadata services live
  ['172.16.0.0',   12],   // private
  ['192.0.0.0',    24],   // IETF protocol assignments
  ['192.0.2.0',    24],   // documentation
  ['192.88.99.0',  24],   // 6to4 relay anycast
  ['192.168.0.0',  16],   // private
  ['198.18.0.0',   15],   // benchmarking
  ['198.51.100.0', 24],   // documentation
  ['203.0.113.0',  24],   // documentation
  ['224.0.0.0',     4],   // multicast
  ['240.0.0.0',     4],   // reserved, and the broadcast address
]) blocked.addSubnet(address, prefix, 'ipv4');

// IPv6. IPv4-mapped addresses (::ffff:127.0.0.1) are matched against the IPv4
// rules above by BlockList itself. NAT64 and 6to4 embed an IPv4 address that
// could be anything, so they are refused outright — no favicon is worth
// decoding them for.
for (const [address, prefix] of [
  ['::',        128],     // unspecified
  ['::1',       128],     // loopback
  ['64:ff9b::',  96],     // NAT64
  ['100::',      64],     // discard-only
  ['2001:db8::', 32],     // documentation
  ['2002::',     16],     // 6to4
  ['fc00::',      7],     // unique local
  ['fe80::',     10],     // link-local
  ['ff00::',      8],     // multicast
]) blocked.addSubnet(address, prefix, 'ipv6');

/** True when an IP address is anywhere a member's fetch must not reach. */
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true;    // not an address at all: refuse rather than guess
}

function refusal(host) {
  const err = new Error(`Refusing to connect to ${host}: not a public address`);
  err.code = 'ENETUNREACH_GUARDED';
  return err;
}

/**
 * An undici connector that resolves, checks every answer, and then connects to
 * the exact address it checked.
 */
function guardedConnector(options = {}) {
  const connect = buildConnector(options);

  return (opts, callback) => {
    const host = String(opts.hostname || '').replace(/^\[|\]$/g, '');

    const dial = address => {
      if (isPrivateAddress(address)) return callback(refusal(host));
      connect({
        ...opts,
        hostname: address,
        // TLS still has to be told which name it is talking to, now that the
        // connection is going to a bare address.
        servername: opts.servername || (net.isIP(host) ? undefined : host),
      }, callback);
    };

    if (net.isIP(host)) return dial(host);

    dns.lookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses?.length) return callback(refusal(host));
      if (addresses.some(a => isPrivateAddress(a.address))) return callback(refusal(host));
      dial(addresses[0].address);
    });
  };
}

/**
 * The dispatcher for any fetch a member can cause. Certificates are verified —
 * unlike the administrator's favicon fetcher, which tolerates self-signed
 * intranet certificates, there is no intranet on this side.
 */
function publicOnlyDispatcher({ timeoutMs = 4500 } = {}) {
  return new Agent({
    connect:        guardedConnector({ timeout: timeoutMs }),
    headersTimeout: timeoutMs,
    bodyTimeout:    timeoutMs,
  });
}

module.exports = { isPrivateAddress, guardedConnector, publicOnlyDispatcher };
