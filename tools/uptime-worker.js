// Uptime check for omnibeam.site: Cloudflare Worker "omnibeam-ping", run by a Cron Trigger every 5 minutes.
// It loads the home page (which also keeps the Node app warm, as the old ping did). After 2 failed checks in a row
// it sends one "down" alert, and one more when the site answers again, so an outage is reported within about
// 10 minutes. The server can't send alerts while it is down, so the Worker sends them itself, by Telegram.
//
// Setup in the Cloudflare dashboard (Workers & Pages > omnibeam-ping):
//   - Bindings: a KV namespace bound as UPTIME (it keeps the count of failed checks between runs)
//   - Variables and Secrets: TELEGRAM_TOKEN as a Secret (the bot token from @BotFather; never in this file).
//     Optional: TELEGRAM_CHAT (your chat id). Without it, send any message to the bot once and the Worker finds
//     the chat by itself.
//   - Triggers: Cron */5 * * * *
//   - For the public status page (omnibeam.site/status): STATUS_KEY as a Secret, the same long random text as the
//     STATUS_KEY environment variable of the Node app in cPanel. The Worker then sends every check result to
//     https://omnibeam.site/api/status/checks. Results it could not send (the site was down) are kept in KV and sent
//     with the next check that gets through, so the status page also shows the outage.
// Opening the Worker's address shows the current state (nothing secret); /test-alert sends one test message.
const TARGET = 'https://omnibeam.site/';
const STATUS_URL = 'https://omnibeam.site/api/status/checks';
const FAILS_FOR_ALERT = 2;
const TIMEOUT_MS = 20000;
const STATUS_BACKLOG = 3000; // about 10 days of checks every 5 minutes

// Send this check (and any still waiting) to the status page. Only the result: when, ok or not, how long, the HTTP code.
async function report(env, result) {
  if (!env.STATUS_KEY || !env.UPTIME) return;
  const pending = ((await env.UPTIME.get('pending', 'json')) || []).concat({ at: Date.now(), ok: result.ok, ms: result.ms, status: result.status, error: result.error }).slice(-STATUS_BACKLOG);
  try {
    const res = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${String(env.STATUS_KEY).trim()}`, 'user-agent': 'omnibeam-ping/2 (Cloudflare Worker cron)' },
      body: JSON.stringify({ checks: pending }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      await env.UPTIME.delete('pending');
      return;
    }
    console.error(`Status page answered ${res.status}` + (res.status === 403 ? ' (STATUS_KEY differs from the one in cPanel)' : ''));
  } catch (err) {
    console.error('Status page not reached: ' + (err.message || err));
  }
  await env.UPTIME.put('pending', JSON.stringify(pending));
}

// One check: the home page must answer 200 with OmniBeam's page (a Cloudflare error page or a timeout is a failure)
async function check() {
  const t0 = Date.now();
  try {
    // A new query each time so no cache answers for the server
    const res = await fetch(`${TARGET}?uptime=${t0}`, {
      headers: { 'user-agent': 'omnibeam-ping/2 (Cloudflare Worker cron)' },
      cf: { cacheTtl: 0 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const ok = res.status === 200 && body.includes('OmniBeam');
    const result = { ok, status: res.status, ms: Date.now() - t0, error: ok ? '' : `HTTP ${res.status}` };
    console.log(JSON.stringify({ target: TARGET, ...result }));
    return result;
  } catch (err) {
    const result = { ok: false, status: 0, ms: Date.now() - t0, error: String(err && err.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000} s` : err) };
    console.error(JSON.stringify({ target: TARGET, ...result }));
    return result;
  }
}

async function telegram(env, method, params) {
  // Spaces or a line break pasted with the token, or a "bot" in front of it, would make every call fail
  const token = String(env.TELEGRAM_TOKEN).trim().replace(/^bot/i, '');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

// The chat to write to: TELEGRAM_CHAT, else the one remembered, else the last chat that wrote to the bot
async function chatId(env) {
  if (env.TELEGRAM_CHAT) return env.TELEGRAM_CHAT;
  const saved = await env.UPTIME.get('chat');
  if (saved) return saved;
  const updates = await telegram(env, 'getUpdates', {});
  const last = updates.reverse().find((u) => u.message && u.message.chat);
  if (!last) throw new Error('Telegram: no chat yet. Send any message to the bot once.');
  const id = String(last.message.chat.id);
  await env.UPTIME.put('chat', id);
  return id;
}

async function alert(env, text) {
  if (!env.TELEGRAM_TOKEN) {
    console.error('Alert not sent (no TELEGRAM_TOKEN secret): ' + text);
    return false;
  }
  try {
    await telegram(env, 'sendMessage', { chat_id: await chatId(env), text, disable_web_page_preview: true });
    console.log('Alert sent: ' + text);
    return true;
  } catch (err) {
    console.error('Alert failed: ' + (err.message || err));
    return false;
  }
}

const minutes = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`;

async function run(env) {
  const result = await check();
  await report(env, result);
  if (!env.UPTIME) {
    console.error('No KV namespace bound as UPTIME: cannot count failures, no alerts');
    return result;
  }
  const state = (await env.UPTIME.get('state', 'json')) || { fails: 0, down: false, since: 0, alerted: false };
  const now = Date.now();
  if (result.ok) {
    if (state.down && state.alerted) {
      await alert(env, `✅ omnibeam.site is back up (down for about ${minutes(now - state.since)}).`);
    }
    if (state.fails || state.down) await env.UPTIME.put('state', JSON.stringify({ fails: 0, down: false, since: 0, alerted: false }));
  } else {
    state.fails += 1;
    if (!state.since) state.since = now;
    state.last = result.error;
    if (state.fails >= FAILS_FOR_ALERT && !state.down) {
      state.down = true;
      state.alerted = await alert(env, `🔴 omnibeam.site is down: ${state.fails} checks in a row failed (${result.error}). Next message when it's back.`);
    } else if (state.down && !state.alerted) {
      // The first alert didn't go out (Telegram unreachable, no chat yet): try again on the next check
      state.alerted = await alert(env, `🔴 omnibeam.site is down since about ${minutes(now - state.since)} ago (${result.error}).`);
    }
    await env.UPTIME.put('state', JSON.stringify(state));
  }
  return result;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Shows the current state; no check, no alert. /test-alert sends one test message, at most one sent every 10 minutes
  // (the address is public, so it can't be used to flood the chat).
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/test-alert') {
      if (!env.UPTIME) return new Response('No KV namespace bound as UPTIME\n', { status: 500 });
      const last = Number(await env.UPTIME.get('test-at')) || 0;
      if (Date.now() - last < 10 * 60000) return new Response('A test alert was sent less than 10 minutes ago\n', { status: 429 });
      const ok = await alert(env, '🔔 Test alert from omnibeam-ping: alerts for omnibeam.site reach this chat.');
      if (ok) await env.UPTIME.put('test-at', String(Date.now()));
      return new Response(ok ? 'Test alert sent\n' : 'Test alert NOT sent (see the Worker logs: no TELEGRAM_TOKEN, or no chat yet)\n', { status: ok ? 200 : 500 });
    }
    const state = env.UPTIME ? await env.UPTIME.get('state', 'json') : null;
    const text = [
      `omnibeam.site uptime check, every 5 minutes`,
      `state: ${state ? (state.down ? 'DOWN' : state.fails ? `${state.fails} failed check(s)` : 'up') : 'up (no failures yet)'}`,
      state && state.last ? `last error: ${state.last}` : '',
      `alerts: ${env.TELEGRAM_TOKEN ? 'Telegram' : 'none set up (add the TELEGRAM_TOKEN secret)'}`,
      `storage: ${env.UPTIME ? 'KV bound' : 'missing (bind a KV namespace as UPTIME)'}`,
      `status page: ${env.STATUS_KEY ? 'results sent to ' + STATUS_URL : 'off (add the STATUS_KEY secret, the same as in cPanel)'}`,
    ].filter(Boolean).join('\n');
    return new Response(text + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
