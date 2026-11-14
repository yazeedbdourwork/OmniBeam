#!/usr/bin/env node
// OmniBeam from a terminal: send files to your phone or another computer, receive them, or share them by link.
// https://omnibeam.site · GPL-3.0-or-later
'use strict';
const pkg = require('../package.json');
const { CliError, log, loadPaired, savePaired, interrupt, closeAsk } = require('../lib/util');

const HELP = `OmniBeam ${pkg.version}: send files between your devices, from the terminal.

Usage:
  omnibeam send <files or folders...>    send to a device that has OmniBeam open (asks which, if several)
  omnibeam send --text "hello"           send a message (--text - reads it from standard input)
  omnibeam receive                       wait for files from another device and save them here
  omnibeam link <files...>               upload, encrypted, and print a share link anyone can open
  omnibeam get <link>                    download (and decrypt) a share link
  omnibeam devices                       list the devices that can be reached now
  omnibeam pair <code>                   remember a device: on it, tap Pair > Create a pairing code
  omnibeam paired                        list remembered devices (omnibeam unpair <name> forgets one)
  omnibeam unlink <id> --token <token>   delete a share link before it expires

Devices on the same network show up by themselves, and so do remembered (paired) ones on any network. With
nobody around, send and receive show a room link and QR code: open or scan it on the other device.
Use "-" as a file to read standard input (name it with --as <name>).

Options:
  --to <name>          the device to send to (part of its name is enough)
  --room <code>        use this public room (5 letters); --password <p> if it has one
  -o, --out <folder>   where received or downloaded files go (default: this folder; get -o - writes to stdout)
  -y, --yes            receive: accept without asking
  --keep               receive: keep running after the first transfer
  --no-room            receive: don't open a room, only this network and paired devices
  --expires <time>     link: how long it works, like 1h, 24h (default), 3d, 7d
  --downloads <n>      link: delete it after n downloads (1 = one download)
  --pin <digits>       link: ask for this PIN (4-8 digits); get: the PIN to open it
  --json               link: print the link and its details as JSON
  --list               get: only list what the link holds
  --name <name>        the name other devices see (default: this computer's name)
  --server <url>       another OmniBeam server (default https://omnibeam.site, or $OMNIBEAM_SERVER)
  --no-qr              don't print QR codes
  -h, --help           this help · -v, --version  the version

Everything is end-to-end encrypted: the server passes on or stores bytes it can't read.
Examples:
  omnibeam send build.zip --to "Pixel"
  tar czf - ./logs | omnibeam link - --as logs.tar.gz --expires 1h --downloads 1
  omnibeam get "https://omnibeam.site/d/abc123#key" -o ~/Downloads`;

const VALUE = new Set(['to', 'room', 'password', 'out', 'expires', 'downloads', 'pin', 'name', 'server', 'text', 'as', 'token', 'code']);
const SHORT = { o: 'out', y: 'yes', h: 'help', v: 'version', t: 'text' };

function parse(argv) {
  const opts = { args: [], server: process.env.OMNIBEAM_SERVER || 'https://omnibeam.site' };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--') { opts.args.push(...argv.slice(i + 1)); break; }
    if (a === '-' || !a.startsWith('-')) { opts.args.push(a); continue; }
    let value;
    if (a.startsWith('--') && a.includes('=')) [a, value] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    let key = a.startsWith('--') ? a.slice(2) : SHORT[a.slice(1)];
    if (!key) throw new CliError(`Unknown option ${a} (see omnibeam --help)`);
    if (key.startsWith('no-')) { opts[{ room: 'newRoom' }[key.slice(3)] || key.slice(3)] = false; continue; }
    if (VALUE.has(key)) {
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new CliError(`${a} needs a value`);
        value = argv[++i];
      }
      opts[key] = value;
    } else if (['yes', 'keep', 'json', 'list', 'help', 'version'].includes(key)) {
      opts[key] = true;
    } else {
      throw new CliError(`Unknown option ${a} (see omnibeam --help)`);
    }
  }
  opts.server = opts.server.replace(/\/$/, '');
  if (!/^https?:\/\//.test(opts.server)) opts.server = `https://${opts.server}`;
  return opts;
}

async function devices(opts) {
  const { openHub } = require('../lib/find');
  const hub = await openHub(opts);
  await hub.settle(2000);
  const list = [...hub.peers.values()];
  if (opts.json) console.log(JSON.stringify(list.map((p) => ({ name: p.name, device: p.info.device }))));
  else if (!list.length) log('No devices found. Open OmniBeam on the other device (same network, a paired device, or --room).');
  else list.forEach((p) => console.log(`${p.name}\t${p.info.device || ''}`));
  await hub.close();
}

async function pair(opts) {
  const [code] = opts.args;
  if (!/^\d{6}$/.test(String(code || '').replace(/\D/g, ''))) throw new CliError('Usage: omnibeam pair <6-digit code>. On the other device: Pair > Create a pairing code.');
  const { Hub, pairWithCode } = require('../lib/hub');
  const hub = new Hub({ server: opts.server, name: opts.name });
  await hub.connect();
  log('Waiting for the other device… (it must have created this code: Pair > Create a pairing code)');
  const name = await pairWithCode(hub, code);
  log(`Paired with ${name}. It now finds this computer on any network.`);
  log(`Tip: on ${name}, open Pair and tick "Trusted" next to this computer, so files you send arrive without asking.`);
  await hub.close();
}

function paired(opts) {
  const list = loadPaired();
  if (opts.json) return console.log(JSON.stringify(list.map(({ name, at }) => ({ name, paired: new Date(at).toISOString() }))));
  if (!list.length) return log('No remembered devices. Pair one with: omnibeam pair <code>');
  for (const p of list) console.log(`${p.name}\tpaired ${new Date(p.at).toLocaleDateString()}`);
}

function unpair(opts) {
  const want = opts.args.join(' ').toLowerCase();
  if (!want) throw new CliError('Usage: omnibeam unpair <name>');
  const list = loadPaired();
  const left = list.filter((p) => !p.name.toLowerCase().includes(want));
  if (left.length === list.length) throw new CliError(`No remembered device called "${opts.args.join(' ')}"`);
  savePaired(left);
  log(`Forgot ${list.length - left.length === 1 ? '1 device' : `${list.length - left.length} devices`}.`);
}

const COMMANDS = {
  send: () => require('../lib/send').send,
  receive: () => require('../lib/receive').receive,
  recv: () => require('../lib/receive').receive,
  link: () => require('../lib/link').link,
  share: () => require('../lib/link').link,
  get: () => require('../lib/link').get,
  unlink: () => require('../lib/link').unlink,
  devices: () => devices,
  list: () => devices,
  pair: () => pair,
  paired: () => paired,
  unpair: () => unpair,
};

function onError(err) {
  closeAsk();
  if (process.stderr.isTTY) process.stderr.write('\n');
  if (err instanceof CliError) log(`omnibeam: ${err.message}`);
  else log(`omnibeam: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
}

async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) throw new CliError(`This needs Node.js 22 or newer; this is ${process.version} (https://nodejs.org)`);
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  process.on('SIGINT', interrupt);
  const argv = process.argv.slice(2);
  const opts = parse(argv);
  if (opts.version) return console.log(pkg.version);
  const [cmd, ...rest] = opts.args;
  if (opts.help || !cmd || cmd === 'help') { console.log(HELP); return; }
  const pick = COMMANDS[cmd];
  if (!pick) throw new CliError(`Unknown command "${cmd}". Try: omnibeam send, receive, link, get, devices (or --help)`);
  opts.args = rest;
  await pick()(opts);
  closeAsk();
}

main().then(() => {
  // The connection to the server can keep Node running for a moment after a command is done
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
}, onError);
