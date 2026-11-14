// Connecting and picking a device: the ones on the same network and remembered (paired) ones show up by themselves;
// --room joins a public room; with nobody around, a new room is made and its link and QR code are shown, so a
// phone anywhere can join by scanning it.
'use strict';
const { Hub, randomRoom, sleep } = require('./hub');
const { fail, log, ask, showQr } = require('./util');

// onPeer: called for every device, from the first one on (before any of them can send anything)
async function openHub(opts, onPeer) {
  const hub = new Hub({ server: opts.server, name: opts.name });
  if (onPeer) hub.on('peer', onPeer);
  await hub.connect();
  hub.on('lost', () => {
    log('OmniBeam: the connection to the server closed');
    process.exit(1);
  });
  if (opts.room) await enterRoom(hub, opts.room, opts.password);
  return hub;
}

async function enterRoom(hub, code, password) {
  code = String(code).toLowerCase();
  if (!/^[a-z]{5}$/.test(code)) fail('A room code is 5 letters, like "kqzmt"');
  const res = await hub.joinRoom(code, password);
  if (!res.ok) {
    fail({ full: 'That room is full', password: 'This room needs a password (--password)', 'wrong-password': 'Wrong password' }[res.reason]
      || 'Too many attempts. Wait a few minutes and try again.');
  }
  return code;
}

// Make a room, show how to join it, and resolve with the first device that does
async function waitInNewRoom(hub, opts, why) {
  let code;
  for (let i = 0; i < 3 && !code; i++) {
    const c = randomRoom();
    const res = await hub.joinRoom(c, opts.password);
    if (res.ok) code = c;
    else if (res.reason !== 'full') fail('Could not open a room. Wait a few minutes and try again.');
  }
  if (!code) fail('Could not open a room. Try again.');
  const url = `${opts.server.replace(/\/$/, '')}/#room=${code}`;
  log(why);
  log(`On the other device, open ${url}`);
  log(`(or go to ${opts.server.replace(/^https?:\/\//, '').replace(/\/$/, '')}, tap ⋯ > Public room and type ${code.toUpperCase()}), or scan:`);
  showQr(url, opts);
  return { code, url };
}

function match(list, want) {
  const w = want.toLowerCase();
  const exact = list.filter((p) => p.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const m = list.filter((p) => p.name.toLowerCase().includes(w));
  if (m.length === 1) return m[0];
  fail(m.length ? `Several devices match "${want}": ${m.map((p) => p.name).join(', ')}`
    : `No device called "${want}". Found: ${list.map((p) => p.name).join(', ') || 'none'}`);
}

// One device to send to
async function pickTarget(hub, opts) {
  await hub.settle(opts.room ? 1200 : 1500);
  // Remembered devices can take a moment longer to show up
  for (let i = 0; i < 8 && !hub.peers.size; i++) await sleep(250);
  let list = [...hub.peers.values()];
  if (opts.to) {
    if (!list.length) for (let i = 0; i < 20 && !list.length; i++) { await sleep(250); list = [...hub.peers.values()]; }
    return match(list, opts.to);
  }
  if (list.length === 1) return list[0];
  if (!list.length) {
    if (opts.room) fail('Nobody is in that room yet');
    await waitInNewRoom(hub, opts, 'No devices with OmniBeam open on this network.');
    log('Waiting for a device to join… (Ctrl+C to stop)');
    return new Promise((resolve) => hub.once('peer', (p) => resolve(p)));
  }
  if (!process.stdin.isTTY) fail(`Several devices are here; pick one with --to: ${list.map((p) => p.name).join(', ')}`);
  list.forEach((p, i) => log(`  ${i + 1}. ${p.label}`));
  const n = Number(await ask('Send to which device? Number: '));
  const target = list[n - 1];
  if (!target) fail('No device chosen');
  return target;
}

module.exports = { openHub, enterRoom, waitInNewRoom, pickTarget, match };
