// omnibeam receive: wait for files and messages from other devices and save them in a folder.
// Devices on the same network and remembered ones see this computer by themselves; a room link and QR code are
// shown too, so a phone anywhere can join and send.
'use strict';
const fs = require('fs');
const path = require('path');
const { fail, log, formatSize, plural, progressLine, progressDone, safePath, freeName, askYes, closeAsk, crc32, showQr, setInterrupt } = require('./util');
const { openHub, waitInNewRoom } = require('./find');

async function receive(opts) {
  const dir = path.resolve(opts.out || '.');
  fs.mkdirSync(dir, { recursive: true });
  const keep = !!opts.keep;
  let finishedOne = null;
  const allDone = new Promise((resolve) => (finishedOne = resolve));
  let prompting = Promise.resolve(); // one question at a time
  let failures = 0;

  const onPeer = (p, joined) => {
    if (joined) log(`  ${p.label} is here`);
    p.on('abort', (why) => {
      if (!p.incoming) return;
      log(`\n${p.name} stopped the transfer: ${why}`);
      cleanup(p);
    });
    p.on('left', () => {
      if (!p.incoming) return;
      log(`\n${p.name} went away before the transfer finished`);
      cleanup(p);
    });
    p.on('message', (m, waits) => waits.push(onMessage(p, m).catch((err) => abort(p, `Could not save: ${err.message}`))));
    p.on('chunk', (buf, waits) => {
      const inc = p.incoming;
      const c = inc && inc.current;
      if (!c) return;
      c.crc = crc32(buf, c.crc);
      c.got += buf.length;
      inc.got += buf.length;
      waits.push(new Promise((resolve, reject) => c.out.write(buf, (err) => (err ? reject(err) : resolve()))));
      if (c.got >= c.size) waits.push(finishFile(inc));
    });
  };
  const hub = await openHub(opts, onPeer);
  await hub.settle(300); // the server's answer with the name it gave this computer
  const name = hub.myName || hub.opts.name || require('os').hostname();
  if (opts.room) {
    const url = `${opts.server.replace(/\/$/, '')}/#room=${opts.room.toLowerCase()}`;
    log(`In room ${opts.room.toUpperCase()}: ${url}`);
    showQr(url, opts);
  } else if (opts.newRoom !== false) {
    await waitInNewRoom(hub, opts, `Ready to receive as "${name}". Devices on this network and paired devices see it already.`);
  } else {
    log(`Ready to receive as "${name}" from devices on this network and paired devices.`);
  }
  log(`Saving to ${dir}${keep ? '' : ' (stops after one transfer; --keep to stay)'}. Ctrl+C to stop.`);


  async function onMessage(p, m) {
    switch (m.t) {
      case 'text':
        log(`\nMessage from ${p.name}:`);
        console.log(String(m.text || ''));
        if (!keep) finishedOne();
        break;
      case 'request': {
        if (p.incoming || !Array.isArray(m.files)) return p.sendJson({ t: 'decline' });
        const files = m.files.slice(0, 10000).map((f) => ({ name: safePath(f.name), size: Math.max(0, Number(f.size) || 0) }));
        const total = files.reduce((s, f) => s + f.size, 0);
        const what = `${plural(files.length, 'file')} (${formatSize(total)})`;
        const trusted = p.provesPairing(m.proofs);
        const ok = await (prompting = prompting.then(async () => {
          log(`\n${p.label} wants to send ${what}:`);
          files.slice(0, 8).forEach((f) => log(`  ${f.name}  ${formatSize(f.size)}`));
          if (files.length > 8) log(`  … and ${files.length - 8} more`);
          if (opts.yes || trusted) { log(trusted && !opts.yes ? '  Accepted (paired device).' : '  Accepted.'); return true; }
          if (!process.stdin.isTTY) { log('  Declined: add --yes to accept without asking.'); return false; }
          return askYes('Accept?');
        }));
        if (!ok) return p.sendJson({ t: 'decline' });
        const xid = /^[0-9a-f]{32}$/.test(m.xid) ? m.xid : null;
        p.incoming = { files, total, got: 0, index: 0, current: null, saved: [], sums: {}, xid, started: Date.now(),
          timer: setInterval(() => {
            const inc = p.incoming;
            if (!inc) return;
            p.sendJson({ t: 'progress', got: inc.got }).catch(() => {});
            progressLine('receiving', inc.got, inc.total, inc.started);
          }, 250) };
        p.sendJson({ t: 'accept', have: {} });
        break;
      }
      case 'file': {
        const inc = p.incoming;
        if (!inc || inc.current) return;
        if ((Number(m.offset) || 0) !== 0) return abort(p, 'Could not continue the interrupted transfer');
        const i = inc.index++;
        const rel = safePath(m.name || (inc.files[i] && inc.files[i].name));
        const size = Math.max(0, Number(m.size) || 0);
        const final = freeName(dir, rel);
        const temp = `${final}.omnibeam-part`;
        inc.current = { i, rel, size, final, temp, got: 0, crc: 0, out: fs.createWriteStream(temp) };
        if (size === 0) await finishFile(inc);
        break;
      }
      case 'sum':
        if (p.incoming && m.xid === p.incoming.xid && Number.isInteger(m.i)) p.incoming.sums[m.i] = Number(m.crc) >>> 0;
        break;
      case 'done': {
        const inc = p.incoming;
        if (!inc) return;
        // Every write before this message has finished (chunks are handled in order)
        if (inc.current) await finishFile(inc);
        clearInterval(inc.timer);
        progressLine('receiving', inc.total, inc.total, inc.started);
        progressDone();
        p.sendJson({ t: 'received' });
        p.incoming = null;
        // A sum can come just after 'done' (a file the sender didn't read from the start)
        setTimeout(() => report(p, inc), 300);
        break;
      }
    }
  }

  function finishFile(inc) {
    const c = inc.current;
    inc.current = null;
    return new Promise((resolve, reject) => c.out.end((err) => (err ? reject(err) : resolve()))).then(() => {
      fs.renameSync(c.temp, c.final);
      inc.saved.push(c);
    });
  }

  function report(p, inc) {
    let bad = 0;
    for (const c of inc.saved) {
      const sum = inc.sums[c.i];
      const mark = sum === undefined ? '' : sum === c.crc ? '  ✓ intact' : '  ✗ DAMAGED';
      if (sum !== undefined && sum !== c.crc) bad++;
      console.log(`${path.relative(process.cwd(), c.final) || c.final}${mark}`);
    }
    log(`Received ${plural(inc.saved.length, 'file')} from ${p.name} (${formatSize(inc.total)})`);
    if (bad) { log(`${plural(bad, 'file')} did not match the sender's check. Ask for ${bad > 1 ? 'them' : 'it'} again.`); failures++; }
    if (!keep) finishedOne();
  }

  function cleanup(p) {
    const inc = p.incoming;
    if (!inc) return;
    clearInterval(inc.timer);
    p.incoming = null;
    progressDone();
    if (inc.current) {
      inc.current.out.destroy();
      fs.rm(inc.current.temp, { force: true }, () => {});
    }
    failures++;
    if (!keep) finishedOne();
  }
  function abort(p, why) {
    p.hub.signal(p.id, { abort: why });
    log(`\n${why}`);
    cleanup(p);
  }

  setInterrupt(() => {
    for (const p of hub.peers.values()) if (p.incoming) abort(p, 'Transfer cancelled');
    setTimeout(() => process.exit(130), 200);
  });

  await allDone;
  closeAsk();
  await hub.close();
  if (failures) process.exitCode = 1;
}

module.exports = { receive };
