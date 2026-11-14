// omnibeam send: files, folders, standard input or a message, to a device that has OmniBeam open
'use strict';
const nodeCrypto = require('crypto');
const { fail, log, formatSize, plural, progressLine, progressDone, collectInputs, readInput, readStdinBuffer, crc32 } = require('./util');
const { openHub, pickTarget } = require('./find');

const CHUNK = 256 * 1024;

async function send(opts) {
  if (opts.text === '-') opts.text = (await readStdinBuffer()).toString('utf8').replace(/\s+$/, '');
  if (!opts.args.length && !opts.text) fail('Nothing to send. Try: omnibeam send photo.jpg   or   omnibeam send --text "hello"');
  const files = await collectInputs(opts.args, { stdinName: opts.as });
  const hub = await openHub(opts);
  const target = await pickTarget(hub, opts);
  target.on('left', () => fail(`${target.name} went away`));
  target.on('abort', (why) => fail(`Stopped on ${target.name}: ${why}`));
  let reply = null;
  target.on('message', (m) => { if (reply) reply(m); });
  const next = () => new Promise((resolve) => (reply = resolve));

  // Remembered devices: say which pairing we share (a device that marked us Trusted accepts without asking)
  const proofs = target.myProofs();
  if (proofs.length) hub.signal(target.id, { pairHello: proofs });
  await target.secure();

  if (opts.text) {
    await target.sendJson({ t: 'text', text: opts.text.slice(0, 100000) });
    log(`Message sent to ${target.name}`);
  }

  if (files.length) {
    const total = files.reduce((s, f) => s + f.size, 0);
    // xid: lets the other device check each file arrived intact (the "sum" messages below)
    const xid = nodeCrypto.randomBytes(16).toString('hex');
    log(`Asking ${target.name} to accept ${plural(files.length, 'file')} (${formatSize(total)})…`);
    await target.sendJson({ t: 'request', files: files.map(({ name, size, mime }) => ({ name, size, mime })), proofs, xid });
    for (;;) {
      const m = await next();
      if (m.t === 'decline') fail(m.why === 'space' ? `${target.name} does not have enough free space` : `${target.name} declined`);
      if (m.t === 'accept') break;
    }
    let got = 0;
    let finished;
    const confirmed = new Promise((resolve) => (finished = resolve));
    reply = null;
    target.on('message', (m) => {
      if (m.t === 'progress') got = Number(m.got) || got;
      if (m.t === 'received') finished();
    });
    const started = Date.now();
    const timer = setInterval(() => progressLine('sending', got, total, started), 250);
    for (const [i, f] of files.entries()) {
      await target.sendJson({ t: 'file', name: f.name, size: f.size, mime: f.mime, offset: 0 });
      let crc = 0;
      for await (const block of readInput(f, CHUNK)) {
        crc = crc32(block, crc);
        await target.drain();
        target.sendChunk(block);
      }
      await target.sendJson({ t: 'sum', xid, i, crc });
    }
    await target.sendJson({ t: 'done' });
    await confirmed;
    clearInterval(timer);
    progressLine('sending', total, total, started);
    progressDone();
    log(`Sent ${plural(files.length, 'file')} to ${target.name}`);
  }
  await hub.close();
}

module.exports = { send };
