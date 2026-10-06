// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A minimal SMTP server, in process, for the email tests.
 *
 * Speaks just enough of the protocol for nodemailer to deliver to it over a
 * plain connection — EHLO, optional AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, QUIT —
 * and keeps every message it is given. `rejectWith` makes it refuse delivery,
 * for the tests about what happens when the mail server says no.
 */

const net = require('node:net');

async function startFakeSmtp({ user = null, pass = null, port = 0, onMessage = null } = {}) {
  const messages = [];
  let rejectWith = null;

  const server = net.createServer(socket => {
    let buffer = '';
    let inData = false;
    let data = '';
    let envelope = { from: null, to: [] };
    let authStep = null;
    let authUser = null;

    const say = line => socket.write(`${line}\r\n`);
    say('220 fake-smtp ready');

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            if (rejectWith) { say(rejectWith); continue; }
            messages.push({ ...envelope, raw: data });
            onMessage?.(messages.at(-1));
            envelope = { from: null, to: [] };
            data = '';
            say('250 OK queued');
          } else {
            data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          }
          continue;
        }

        if (authStep === 'login-user') { authUser = Buffer.from(line, 'base64').toString(); authStep = 'login-pass'; say('334 UGFzc3dvcmQ6'); continue; }
        if (authStep === 'login-pass') {
          authStep = null;
          const ok = authUser === user && Buffer.from(line, 'base64').toString() === pass;
          say(ok ? '235 Authenticated' : '535 Bad credentials');
          continue;
        }

        const [verb, ...rest] = line.split(' ');
        const arg = rest.join(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO':
            socket.write('250-fake-smtp\r\n');
            if (user) socket.write('250-AUTH PLAIN LOGIN\r\n');
            say('250 8BITMIME');
            break;
          case 'HELO': say('250 fake-smtp'); break;
          case 'AUTH': {
            const [mech, initial] = arg.split(' ');
            if (mech.toUpperCase() === 'PLAIN') {
              const [, u, p] = Buffer.from(initial || '', 'base64').toString().split('\0');
              say(u === user && p === pass ? '235 Authenticated' : '535 Bad credentials');
            } else if (mech.toUpperCase() === 'LOGIN') {
              authStep = 'login-user'; say('334 VXNlcm5hbWU6');
            } else say('504 Unsupported');
            break;
          }
          case 'MAIL': envelope.from = arg.replace(/^FROM:\s*/i, '').replace(/[<>]/g, '').split(' ')[0]; say('250 OK'); break;
          case 'RCPT': envelope.to.push(arg.replace(/^TO:\s*/i, '').replace(/[<>]/g, '').split(' ')[0]); say('250 OK'); break;
          case 'DATA': inData = true; say('354 Go ahead'); break;
          case 'RSET': envelope = { from: null, to: [] }; say('250 OK'); break;
          case 'NOOP': say('250 OK'); break;
          case 'QUIT': say('221 Bye'); socket.end(); break;
          default: say('502 Not implemented');
        }
      }
    });
    socket.on('error', () => {});
  });

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    messages,
    /** The decoded body text of a message, with quoted-printable soft breaks undone. */
    bodyOf: m => m.raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
    reject(line) { rejectWith = line; },
    accept() { rejectWith = null; },
    stop: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { startFakeSmtp };
