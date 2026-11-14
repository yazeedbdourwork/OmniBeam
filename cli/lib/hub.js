// The connection to the OmniBeam server: who is around (same network, remembered devices, a room), and an
// end-to-end encrypted channel to each of them through the server relay.
//
// Browsers talk to each other directly (WebRTC) when they can; Node has no WebRTC, so this always goes through the
// server, encrypted the same way as the browser's relay (E2E in public/app.js): the two devices agree on an AES-GCM
// key with ECDH, and the server only ever sees the public keys and encrypted bytes.
'use strict';
const os = require('os');
const nodeCrypto = require('crypto');
const { EventEmitter } = require('events');
const { fail, subtle, loadPaired, savePaired, pairProof } = require('./util');

const enc = new TextEncoder();
const dec = new TextDecoder();
const DEVICE = `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'Computer'} command line`;
const MAX_BUFFERED = 4 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Hub extends EventEmitter {
  // opts: { server, name, room, password, code }
  constructor(opts) {
    super();
    this.opts = opts;
    this.peers = new Map(); // id -> Peer
    this.myId = null;
    this.closing = false;
  }

  async connect() {
    if (!subtle || typeof WebSocket !== 'function') fail('This needs Node.js 22 or newer (https://nodejs.org)');
    this.keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    this.pub = Buffer.from(await subtle.exportKey('raw', this.keys.publicKey)).toString('base64');
    let base;
    try { base = new URL(this.opts.server); } catch { fail(`Not a web address: ${this.opts.server}`); }
    const ws = new WebSocket(`${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Could not reach ${this.opts.server}`)), 15000);
      this.once('hello', () => { clearTimeout(timer); resolve(); });
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`Could not connect to ${this.opts.server}`)); };
      ws.onmessage = (e) => this.onMessage(e.data);
    }).catch((err) => fail(err.message));
    ws.onerror = null;
    ws.onclose = () => { if (!this.closing) this.emit('lost'); };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
  signal(to, data) {
    this.send({ type: 'signal', to, data });
  }

  // Join a public room (a 5-letter code anyone can join from omnibeam.site/#room=<code>)
  joinRoom(code, password) {
    const pass = password ? nodeCrypto.createHash('sha256').update(`omnibeam-room:${code}:${password}`).digest('hex') : undefined;
    this.send({ type: 'join-public', code, pass });
    return new Promise((resolve) => this.once('room', resolve));
  }

  onMessage(raw) {
    if (typeof raw !== 'string') return this.onBinary(Buffer.from(raw));
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'hello':
        this.myId = msg.id;
        this.send({ type: 'intro', device: DEVICE, name: this.opts.name || os.hostname().slice(0, 40) });
        if (loadPaired().length) this.send({ type: 'join-secrets', secrets: loadPaired().map((p) => p.secret) });
        if (this.opts.code) this.send({ type: 'join-code', code: String(this.opts.code).replace(/\D/g, '') });
        this.emit('hello');
        break;
      case 'name':
        this.myName = msg.name;
        break;
      case 'peers':
        for (const p of msg.peers) this.addPeer(p);
        this.emit('peers');
        break;
      case 'peer-joined':
        this.addPeer(msg.peer, true);
        break;
      case 'peer-updated':
        if (this.peers.has(msg.peer?.id)) Object.assign(this.peers.get(msg.peer.id).info, msg.peer);
        break;
      case 'peer-left': {
        const p = this.peers.get(msg.id);
        if (p) { this.peers.delete(msg.id); p.emit('left'); this.emit('peer-left', p); }
        break;
      }
      case 'joined-public':
        this.emit('room', { ok: true, code: msg.code });
        break;
      case 'public-error':
        this.emit('room', { ok: false, reason: msg.reason });
        break;
      case 'joined-code':
        this.emit('joined-code', msg.code);
        break;
      case 'code-partner':
        this.emit('code-partner', msg.id);
        break;
      case 'code-error':
        this.emit('code-error', msg.reason);
        break;
      case 'relay': {
        const p = this.peers.get(msg.from);
        if (p) p.onRelay(String(msg.data));
        break;
      }
      case 'signal': {
        const p = this.peers.get(msg.from);
        const data = msg.data || {};
        if (typeof data.pairSecret === 'string' || data.pairSaved) this.emit('pair-signal', msg.from, data);
        if (!p) break;
        if (typeof data.e2e === 'string') p.onKey(data);
        else if (data.pairHello) p.onPairHello(data.pairHello);
        else if (data.abort) p.emit('abort', String(data.abort).slice(0, 120));
        // A browser first tries a direct connection (data.sdp / data.candidate): there is none here, so it falls
        // back to the relay by itself after a few seconds
        break;
      }
    }
  }

  // Binary relay frames: [36-byte sender id][encrypted chunk]
  onBinary(buf) {
    if (buf.length < 36) return;
    const p = this.peers.get(buf.subarray(0, 36).toString('latin1'));
    if (p) p.onRelayBinary(buf.subarray(36));
  }

  addPeer(info, joined = false) {
    if (!info || !info.id || info.id === this.myId) return;
    if (this.peers.has(info.id)) return void Object.assign(this.peers.get(info.id).info, info);
    const p = new Peer(this, info);
    this.peers.set(info.id, p);
    this.emit('peer', p, joined);
  }

  // Wait for the device list to settle (the server sends it right after joining rooms)
  async settle(ms = 1500) {
    await sleep(ms);
  }

  async flush() {
    while (this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount > 0) await sleep(20);
  }
  async close() {
    this.closing = true;
    await this.flush();
    await sleep(200);
    try { this.ws.close(); } catch {}
  }
}

class Peer extends EventEmitter {
  constructor(hub, info) {
    super();
    this.hub = hub;
    this.info = info;
    this.key = null;
    this.theirPub = null;
    this.tx = 0;
    this.rx = 0;
    this.rxChain = Promise.resolve();
    this.txChain = Promise.resolve();
    this.paired = false; // proved it shares one of our remembered pairings
    this.keyWaiters = [];
  }
  get id() { return this.info.id; }
  get name() { return this.info.name || 'Device'; }
  get label() { return `${this.name} (${this.info.device || 'device'})`; }

  // ---------- Key agreement ----------
  onKey(data) {
    const pub = data.e2e;
    if (pub.length > 200) return;
    if (!data.reply) this.hub.signal(this.id, { e2e: this.hub.pub, reply: true });
    if (pub === this.theirPub) return;
    this.theirPub = pub;
    // In the receive order, so messages encrypted with the new key wait for it
    this.rxChain = this.rxChain.then(async () => {
      const theirs = await subtle.importKey('raw', Buffer.from(pub, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, this.hub.keys.privateKey, 256);
      const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      this.key = await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode([this.hub.myId, this.id].sort().join('|')), info: enc.encode('omnibeam-relay-v1') },
        hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      this.tx = 0;
      this.rx = 0;
      this.keyWaiters.splice(0).forEach((w) => w());
    }).catch(() => this.emit('abort', 'Secure connection failed'));
  }
  // Ask for the other device's key (and wait for it)
  async secure(timeout = 15000) {
    if (this.key) return;
    const got = new Promise((resolve) => this.keyWaiters.push(resolve));
    this.hub.signal(this.id, { e2e: this.hub.pub });
    const ok = await Promise.race([got.then(() => true), sleep(timeout).then(() => false)]);
    if (!ok) fail(`${this.name} did not answer (it may need to reload OmniBeam)`);
  }

  onPairHello(list) {
    const mine = new Set(loadPaired().map((p) => pairProof(p.secret, this.id, this.hub.myId)));
    if ([].concat(list).some((x) => mine.has(x))) {
      this.paired = true;
      this.emit('paired');
    }
  }
  // Does a request carry proof that it comes from a remembered device?
  provesPairing(proofs) {
    const mine = new Set(loadPaired().map((p) => pairProof(p.secret, this.id, this.hub.myId)));
    return Array.isArray(proofs) && proofs.some((x) => mine.has(x));
  }
  myProofs() {
    return loadPaired().map((p) => pairProof(p.secret, this.hub.myId, this.id));
  }

  // ---------- Encrypted messages ----------
  async seal(data, kind) {
    const iv = nodeCrypto.randomBytes(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${this.hub.myId}>${this.id}:${this.tx++}:${kind}`) }, this.key, data);
    return Buffer.concat([iv, Buffer.from(ct)]);
  }
  async open(data, kind) {
    const label = `${this.id}>${this.hub.myId}:${this.rx++}:${kind}`;
    return Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: enc.encode(label) }, this.key, data.subarray(12)));
  }
  // Messages and chunks leave in the order they were given (encrypting is asynchronous)
  sendJson(obj) {
    const job = this.txChain.then(async () => {
      const sealed = await this.seal(enc.encode(JSON.stringify(obj)), 't');
      this.hub.send({ type: 'relay', to: this.id, data: 'E1:' + sealed.toString('base64') });
    });
    this.txChain = job.catch(() => {});
    return job;
  }
  sendChunk(buf) {
    const job = this.txChain.then(async () => {
      const sealed = await this.seal(buf, 'b');
      const header = Buffer.from(this.id, 'latin1');
      this.hub.ws.send(Buffer.concat([header, sealed]));
    });
    this.txChain = job.catch(() => {});
    return job;
  }
  // Wait while the connection to the server has a lot queued
  async drain() {
    await this.txChain;
    while (this.hub.ws.readyState === WebSocket.OPEN && this.hub.ws.bufferedAmount > MAX_BUFFERED) await sleep(15);
    if (this.hub.ws.readyState !== WebSocket.OPEN) fail('Connection to the server closed');
  }

  onRelay(data) {
    if (!data.startsWith('E1:')) return;
    this.rxChain = this.rxChain.then(async () => {
      if (!this.key) return;
      const plain = await this.open(Buffer.from(data.slice(3), 'base64'), 't');
      let msg;
      try { msg = JSON.parse(dec.decode(plain)); } catch { return; }
      const waits = [];
      this.emit('message', msg, waits);
      if (waits.length) await Promise.all(waits);
    }).catch(() => this.emit('abort', 'Secure connection failed'));
  }
  onRelayBinary(buf) {
    this.rxChain = this.rxChain.then(async () => {
      if (!this.key) return;
      const plain = await this.open(buf, 'b');
      // The handler may return a promise (writing to disk): the next message waits for it
      const waits = [];
      this.emit('chunk', plain, waits);
      if (waits.length) await Promise.all(waits);
    }).catch(() => this.emit('abort', 'Secure connection failed'));
  }
}

// Remember a device through a 6-digit pairing code created on it (Pair > Create a pairing code)
async function pairWithCode(hub, code) {
  const partners = new Set();
  hub.on('code-partner', (id) => partners.add(id));
  const result = new Promise((resolve, reject) => {
    hub.on('code-error', (reason) => reject(new Error(reason)));
    hub.on('pair-signal', (from, data) => {
      if (!partners.has(from) || !/^[0-9a-f]{64}$/.test(data.pairSecret || '')) return;
      const who = hub.peers.get(from);
      const name = (who && who.name) || String(data.name || 'Paired device').slice(0, 40);
      savePaired([...loadPaired().filter((p) => p.secret !== data.pairSecret), { secret: data.pairSecret, name, at: Date.now() }]);
      hub.signal(from, { pairSaved: true });
      hub.send({ type: 'join-secrets', secrets: [data.pairSecret] });
      hub.send({ type: 'leave-code' });
      resolve(name);
    });
  });
  hub.send({ type: 'join-code', code: String(code).replace(/\D/g, '') });
  return Promise.race([result, sleep(90000).then(() => { throw new Error('The other device did not answer. Create a new code on it and try again.'); })])
    .catch((err) => fail(err.message));
}

// A random room code: 5 letters, without ones that are easy to mix up when read aloud
function randomRoom() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  return Array.from(nodeCrypto.randomBytes(5), (b) => letters[b % letters.length]).join('');
}

module.exports = { Hub, Peer, pairWithCode, randomRoom, DEVICE, sleep };
