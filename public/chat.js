// OmniBeam: the chat view of one device, loaded by app.js when it is first opened (More… on a device -> Chat, the
// Chat button of a paired device, or the small number on a card). It shows what was sent to and received from that
// device, messages and files, in time order, like a messenger: what came in on one side, what this device sent on
// the other (the sides follow the page's direction, so they swap in Arabic and Urdu). Received photos show a small
// picture and every received file can be saved or previewed; sent files show their name and how the send went.
// It is the only place to write and read messages (every "Send message" opens it; a message that arrives while it is
// closed opens it by itself, or shows a small banner that opens it when the person is busy with something else).
// The head has Ring (to find that device), Pin a note, the message sound (on/off) and Clear chat. A pinned note (a
// Wi-Fi password, an address) stays at the top of the chat, on this device only, until it is unpinned: also after
// the messages are cleared or too old. A message that is only a link has an Open link button. The box at the bottom sends a message or files to that
// device; a paired device that is offline gets them as soon as it opens OmniBeam (like its greyed card). Everything comes from the history kept on this device (see Chat view in
// app.js): nothing new is stored, and nothing goes to the server.
// Messenger look (2026-11-24): coloured bubbles with tails, grouped when close together; ticks on sent messages
// (✓ sent, ✓✓ arrived, blue ✓✓ read: the other device says so when the message reaches it and when its chat is on
// screen); "typing…"; reactions and Reply (with a quote of the message answered) shared with the other device;
// a message menu (long-press, right-click or the small arrow: react, Reply, Copy, Pin, Delete for me); an emoji
// panel; the round Send button (the paper clip while the box is empty); photos filling their bubble; a wallpaper;
// "↓ New messages" when scrolled up; a small card for links (made here from the address: no page is fetched); big
// emoji. Older versions of OmniBeam ignore ticks, typing and reactions, and show a reply as a plain message.
// More (2026-11-25): voice and video calls (call.js), search in the chat, "Media, files and links", Forward a message
// or file to another device, Translate a message (the browser's own on-device translator, where it has one),
// disappearing messages (a timer for the chat, set on both devices), Send later, and a photo editor (edit.js) when
// one photo is chosen. The head keeps calls, search and ⋮ (Ring, Pin a note, sound, Clear chat… are in ⋮).
'use strict';
(function () {
  const STYLE = `
.chat-dialog { width: min(640px, 100vw); max-width: 100vw; height: min(820px, 100dvh); max-height: 100dvh; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.chat-dialog:not([open]) { display: none; }
@media (max-width: 640px) { .chat-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; } }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border, rgba(127,127,127,.25)); }
.chat-head .avatar { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; color: #fff; }
.chat-head .avatar svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.chat-head .avatar .emoji { font-size: 22px; }
.chat-head .chat-who { flex: 1; min-width: 0; }
.chat-head .chat-who b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-head .chat-who small { opacity: .75; }
.chat-thread { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain; background-color: rgba(127,127,127,.06); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cg fill='none' stroke='%23808080' stroke-opacity='.16' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 30h18l6 6v22H20z M38 30v6h6'/%3E%3Cpath d='M112 22l14 8-14 8 3-8z'/%3E%3Cpath d='M70 92c0-5 7-5 7 0 0-5 7-5 7 0 0 5-7 9-7 11-0-2-7-6-7-11z'/%3E%3Ccircle cx='130' cy='110' r='7'/%3E%3Cpath d='M24 120l6 6 12-12'/%3E%3Cpath d='M90 140h20M100 130v20'/%3E%3Cpath d='M66 30a8 8 0 0 1 16 0'/%3E%3C/g%3E%3C/svg%3E"); background-size: 160px 160px; }
.chat-day { align-self: center; font-size: 12px; opacity: .7; padding: 2px 10px; border-radius: 999px; background: rgba(127,127,127,.15); margin: 8px 0 2px; }
.chat-empty { margin: auto; text-align: center; opacity: .75; max-width: 30ch; }
.bubble { position: relative; max-width: min(78%, 440px); padding: 7px 10px 5px; border-radius: 18px; background: var(--bubble-in); color: inherit; overflow-wrap: anywhere; unicode-bidi: plaintext; box-shadow: 0 1px 1.5px rgba(0,0,0,.13); -webkit-touch-callout: none; transition: transform .15s; }
.chat-dialog { --bubble-in: #fff; --bubble-out: #6c5ce7; --bubble-out-fg: #fff; --tick-read: #53bdeb; }
:root[data-theme="dark"] .chat-dialog { --bubble-in: #3a3e4b; --bubble-out: #6f63e8; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .chat-dialog { --bubble-in: #3a3e4b; --bubble-out: #6f63e8; } }
.bubble.in { align-self: flex-start; }
.bubble.out { align-self: flex-end; background: var(--bubble-out); color: var(--bubble-out-fg); }
.bubble.in .msg-text a { color: var(--accent, #6c5ce7); }
.bubble.out a, .bubble.out .link-btn { color: inherit !important; text-decoration: underline; }
.bubble.grp { margin-top: -3px; }
.bubble.in.grp { border-start-start-radius: 6px; }
.bubble.out.grp { border-start-end-radius: 6px; }
.bubble.in.more-next { border-end-start-radius: 6px; }
.bubble.out.more-next { border-end-end-radius: 6px; }
.bubble.tail.in { border-end-start-radius: 4px; }
.bubble.tail.out { border-end-end-radius: 4px; }
.bubble.tail::after { content: ""; position: absolute; bottom: 0; width: 10px; height: 14px; background: inherit; }
.bubble.tail.in::after { left: -5px; clip-path: polygon(100% 0, 100% 100%, 0 100%); border-bottom-left-radius: 3px; }
.bubble.tail.out::after { right: -5px; clip-path: polygon(0 0, 100% 100%, 0 100%); border-bottom-right-radius: 3px; }
[dir=rtl] .bubble.tail.in::after { left: auto; right: -5px; clip-path: polygon(0 0, 100% 100%, 0 100%); }
[dir=rtl] .bubble.tail.out::after { right: auto; left: -5px; clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.bubble.big-emoji { background: none; box-shadow: none; padding: 0 2px; }
.bubble.big-emoji::after { display: none; }
.bubble.big-emoji .msg-text { font-size: 44px; line-height: 1.15; }
.bubble.big-emoji .chat-meta { background: rgba(0,0,0,.35); color: #fff; padding: 1px 6px; border-radius: 8px; opacity: 1; }
.bubble.has-react { margin-bottom: 14px; }
.bubble .chat-react { position: absolute; bottom: -15px; right: 10px; display: flex; gap: 1px; padding: 1px 5px; border-radius: 999px; background: var(--bubble-in); color: var(--fg, #222); box-shadow: 0 1px 3px rgba(0,0,0,.25); font-size: 14px; line-height: 20px; cursor: pointer; border: 0; font-family: inherit; }
.bubble.in .chat-react { right: auto; left: 10px; }
[dir=rtl] .bubble .chat-react { right: auto; left: 10px; }
[dir=rtl] .bubble.in .chat-react { left: auto; right: 10px; }
.bubble .chat-react .n { font-size: 11px; margin-inline-start: 2px; opacity: .8; }
.bubble-more { position: absolute; top: 2px; right: 2px; width: 24px; height: 24px; border: 0; border-radius: 50%; padding: 0; background: inherit; color: inherit; font-size: 13px; line-height: 24px; cursor: pointer; opacity: 0; transition: opacity .15s; }
[dir=rtl] .bubble-more { right: auto; left: 2px; }
.bubble:hover .bubble-more, .bubble-more:focus { opacity: .9; }
@media (hover: none) { .bubble-more { pointer-events: none; } }
.bubble .chat-quote { display: block; width: 100%; text-align: start; border: 0; border-inline-start: 3px solid var(--accent, #6c5ce7); border-radius: 8px; background: rgba(127,127,127,.16); color: inherit; font: inherit; font-size: 12.5px; padding: 4px 8px; margin: 2px 0 5px; cursor: pointer; overflow: hidden; }
.bubble.out .chat-quote { background: rgba(255,255,255,.18); border-inline-start-color: rgba(255,255,255,.85); }
.bubble .chat-quote b { display: block; font-size: 12px; color: var(--accent, #6c5ce7); }
.bubble.out .chat-quote b { color: inherit; }
.bubble .chat-quote span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .85; unicode-bidi: plaintext; }
.bubble .chat-link-card, .chat-media .chat-link-card { display: flex; gap: 8px; align-items: center; margin: 6px 0 2px; padding: 6px 8px; border-radius: 10px; background: rgba(127,127,127,.14); color: inherit !important; text-decoration: none !important; min-width: 0; }
.bubble.out .chat-link-card { background: rgba(255,255,255,.16); }
.bubble .chat-link-card .lc-ico, .chat-media .chat-link-card .lc-ico { flex: none; width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 16px; text-transform: uppercase; }
.bubble .chat-link-card .lc-txt, .chat-media .chat-link-card .lc-txt { min-width: 0; }
.bubble .chat-link-card b, .bubble .chat-link-card small, .chat-media .chat-link-card b, .chat-media .chat-link-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bubble .chat-link-card small, .chat-media .chat-link-card small { opacity: .75; font-size: 11.5px; }
.bubble.flash { animation: chat-flash 1.2s; }
@keyframes chat-flash { 0%, 60% { box-shadow: 0 0 0 3px var(--accent, #6c5ce7); } 100% { box-shadow: 0 1px 1.5px rgba(0,0,0,.13); } }
.bubble.photo { padding: 3px; }
.bubble.photo .chat-file, .bubble.photo .chat-acts, .bubble.photo .chat-foot { padding: 0 7px; }
.bubble.photo .chat-foot { padding-bottom: 3px; }
.chat-photo { position: relative; }
.chat-photo .chat-thumb { width: 100%; max-height: 320px; object-fit: cover; margin-bottom: 4px; border-radius: 15px; }
.chat-photo .chat-meta.on-photo { position: absolute; bottom: 10px; right: 8px; background: rgba(0,0,0,.45); color: #fff; padding: 1px 7px; border-radius: 9px; opacity: 1; }
[dir=rtl] .chat-photo .chat-meta.on-photo { right: auto; left: 8px; }
.chat-meta .tick { display: inline-block; margin-inline-start: 3px; letter-spacing: -3px; font-weight: 700; padding-inline-end: 3px; }
.chat-meta .tick.r { color: var(--tick-read); }
.bubble.out .chat-meta .tick.r { color: #8fe3ff; }
.chat-typing { align-self: flex-start; background: var(--bubble-in); border-radius: 18px; border-end-start-radius: 4px; padding: 10px 14px; display: flex; gap: 4px; box-shadow: 0 1px 1.5px rgba(0,0,0,.13); }
.chat-typing i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .4; animation: chat-dot 1.2s infinite; }
.chat-typing i:nth-child(2) { animation-delay: .2s; }
.chat-typing i:nth-child(3) { animation-delay: .4s; }
@keyframes chat-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-4px); opacity: .9; } }
.chat-head .chat-state.typing { color: var(--accent, #6c5ce7); opacity: 1; font-weight: 600; }
.chat-jump { position: -webkit-sticky; position: sticky; bottom: 4px; align-self: center; margin-top: auto; z-index: 2; border: 0; border-radius: 999px; padding: 7px 14px; background: var(--accent, #6c5ce7); color: #fff; font: inherit; font-size: 13px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.25); cursor: pointer; }
.chat-jump[hidden] { display: none; }
.chat-menu { position: fixed; z-index: 30; min-width: 210px; max-width: calc(100vw - 16px); padding: 6px; border-radius: 16px; background: var(--bg, #fff); color: var(--fg, #222); box-shadow: 0 8px 30px rgba(0,0,0,.3); }
.chat-menu[hidden], .chat-menu [hidden] { display: none !important; }
@media (hover: none) { .bubble { -webkit-user-select: none; user-select: none; } }
.chat-menu .react-row { display: flex; justify-content: space-between; gap: 2px; padding: 2px 2px 6px; border-bottom: 1px solid var(--border, rgba(127,127,127,.25)); margin-bottom: 4px; }
.chat-menu .react-row button { border: 0; background: none; font-size: 24px; line-height: 1; padding: 5px; border-radius: 50%; cursor: pointer; transition: transform .1s; }
.chat-menu .react-row button:hover, .chat-menu .react-row button:focus { transform: scale(1.25); background: rgba(127,127,127,.15); }
.chat-menu .react-row button[aria-pressed="true"] { background: var(--accent-soft, rgba(124,92,255,.2)); }
.chat-menu .menu-item { display: flex; width: 100%; align-items: center; gap: 10px; border: 0; background: none; color: inherit; font: inherit; font-size: 14.5px; padding: 9px 10px; border-radius: 10px; cursor: pointer; text-align: start; }
.chat-menu .menu-item:hover, .chat-menu .menu-item:focus { background: rgba(127,127,127,.14); }
.chat-menu .menu-item.danger { color: var(--danger, #c0392b); }
.chat-menu .menu-item span:first-child { width: 20px; text-align: center; }
.chat-emoji { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 2px; max-height: 190px; overflow-y: auto; padding: 6px 10px; border-top: 1px solid var(--border, rgba(127,127,127,.25)); }
.chat-emoji[hidden] { display: none; }
.chat-emoji button { border: 0; background: none; font-size: 24px; padding: 4px 0; border-radius: 8px; cursor: pointer; }
.chat-emoji button:hover, .chat-emoji button:focus { background: rgba(127,127,127,.15); }
.chat-replying { display: flex; align-items: center; gap: 8px; margin: 0 10px; padding: 6px 10px; border-inline-start: 3px solid var(--accent, #6c5ce7); border-radius: 8px; background: rgba(127,127,127,.12); font-size: 13px; }
.chat-replying[hidden] { display: none; }
.chat-replying div { flex: 1; min-width: 0; }
.chat-replying b { display: block; color: var(--accent, #6c5ce7); font-size: 12px; }
.chat-replying span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; unicode-bidi: plaintext; }
.chat-compose .round { width: 44px; height: 44px; border-radius: 50%; background: var(--accent, #6c5ce7); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.2); border: 0; display: flex; align-items: center; justify-content: center; }
.chat-compose .round svg { width: 21px; height: 21px; stroke: currentColor; fill: none; stroke-width: 2; }
.chat-compose .round:disabled { opacity: .5; }
.chat-compose [hidden] { display: none !important; }
.bubble .msg-text { white-space: pre-wrap; unicode-bidi: plaintext; text-align: start; }
.bubble .chat-meta { font-size: 11px; opacity: .72; white-space: nowrap; }
.bubble .chat-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 3px; }
.bubble .chat-foot .chat-acts { margin: 0; margin-inline-end: auto; }
.bubble .chat-file { display: flex; align-items: center; gap: 8px; }
.bubble .chat-file .chat-icon { font-size: 22px; flex: none; }
.bubble .chat-file .chat-name { font-weight: 600; overflow-wrap: anywhere; unicode-bidi: plaintext; }
.bubble .chat-file small { opacity: .75; display: block; }
.bubble .chat-thumb { display: block; max-width: 100%; max-height: 240px; border-radius: 10px; margin-bottom: 6px; background: rgba(127,127,127,.15); cursor: zoom-in; }
.bubble .chat-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.bubble .chat-acts .link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.bubble.failed .chat-meta, .bubble.declined .chat-meta, .bubble.cancelled .chat-meta { color: var(--danger, #c0392b); opacity: 1; }
.chat-compose { border-top: 1px solid var(--border, rgba(127,127,127,.25)); padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: flex-end; }
.chat-compose textarea { flex: 1; resize: none; min-height: 40px; max-height: 140px; padding: 9px 12px; border-radius: 20px; border: 1px solid var(--border, rgba(127,127,127,.35)); background: transparent; color: inherit; font: inherit; unicode-bidi: plaintext; }
.chat-compose .icon-btn { flex: none; }
.chat-note { font-size: 12px; opacity: .8; padding: 0 12px 6px; }
.chat-dialog .shrink-toggle { margin: 0; padding: 2px 12px 2px; justify-content: flex-end; gap: 2px; font-size: 11.5px; opacity: .85; }
.chat-dialog .shrink-toggle button { padding: 2px 8px; box-shadow: none; background: transparent; font-weight: 600; }
.chat-dialog .shrink-toggle button[aria-pressed="true"] { box-shadow: none; text-decoration: underline; text-underline-offset: 3px; }
.bubble.chat-ask .chat-acts .btn { min-width: 6em; }
.chat-head .icon-btn[data-act=sound][aria-pressed="false"] { opacity: .6; }
.chat-notif { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 12px 6px; padding: 8px 10px; border-radius: 12px; font-size: 13px; background: var(--accent-soft, rgba(124,92,255,.14)); }
.chat-notif span { flex: 1; min-width: 12em; }
.chat-clear-both { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 14px; cursor: pointer; }
.chat-clear-both[hidden] { display: none; }
.chat-pin { display: flex; align-items: flex-start; gap: 8px; margin: 8px 12px 0; padding: 8px 10px; border-radius: 12px; background: var(--accent-soft, rgba(124,92,255,.14)); border: 1px solid var(--border, rgba(127,127,127,.2)); }
.chat-pin:not([hidden]) + .chat-thread { padding-top: 8px; }
.chat-pin .pin-ico { flex: none; font-size: 15px; line-height: 1.4; }
.chat-pin .pin-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: plaintext; text-align: start; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; font-size: 14px; }
.chat-pin.open .pin-text { -webkit-line-clamp: unset; display: block; max-height: 40vh; overflow-y: auto; }
.chat-pin .pin-acts { display: flex; gap: 10px; flex: none; }
.chat-pin .link-btn, .bubble .chat-acts .link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.bubble .chat-link-open { margin-top: 6px; }
.chat-dialog { position: fixed; }
.chat-head { gap: 4px; }
.chat-head .avatar { margin-inline-end: 6px; }
.chat-head .icon-btn[hidden] { display: none; }
.chat-head-menu { position: absolute; top: 56px; right: 8px; z-index: 31; min-width: 230px; max-width: calc(100% - 16px); padding: 6px; border-radius: 16px; background: var(--bg, #fff); color: var(--fg, #222); box-shadow: 0 8px 30px rgba(0,0,0,.3); }
[dir=rtl] .chat-head-menu { right: auto; left: 8px; }
.chat-head-menu[hidden], .chat-head-menu [hidden] { display: none !important; }
.chat-head-menu .menu-item { display: flex; width: 100%; align-items: center; gap: 10px; border: 0; background: none; color: inherit; font: inherit; font-size: 14.5px; padding: 9px 10px; border-radius: 10px; cursor: pointer; text-align: start; }
.chat-head-menu .menu-item:hover, .chat-head-menu .menu-item:focus { background: rgba(127,127,127,.14); }
.chat-head-menu .menu-item:disabled { opacity: .45; cursor: default; }
.chat-head-menu .menu-item.danger { color: var(--danger, #c0392b); }
.chat-head-menu .menu-item svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; }
.chat-search { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border, rgba(127,127,127,.25)); }
.chat-search[hidden] { display: none; }
.chat-search input { flex: 1; min-width: 0; padding: 7px 12px; border-radius: 18px; border: 1px solid var(--border, rgba(127,127,127,.35)); background: transparent; color: inherit; font: inherit; }
.chat-search .n { font-size: 12px; opacity: .75; white-space: nowrap; }
.bubble mark { background: #ffe066; color: #222; border-radius: 3px; padding: 0 1px; }
.bubble.hit-now { box-shadow: 0 0 0 3px #ffe066; }
.chat-vanish { display: flex; align-items: center; gap: 8px; margin: 8px 12px 0; padding: 6px 10px; border-radius: 12px; font-size: 13px; background: rgba(127,127,127,.12); border: 0; color: inherit; font-family: inherit; cursor: pointer; text-align: start; }
.chat-vanish[hidden] { display: none; }
.bubble .chat-fwd { display: block; font-size: 11.5px; font-style: italic; opacity: .75; margin-bottom: 2px; }
.bubble .msg-trans { margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(127,127,127,.3); white-space: pre-wrap; unicode-bidi: plaintext; text-align: start; }
.bubble .msg-trans small { display: block; font-size: 11px; opacity: .7; }
.bubble.later { opacity: .85; border: 1.5px dashed rgba(255,255,255,.6); }
.bubble.later .chat-meta { opacity: 1; }
.bubble.later .chat-acts .link-btn { color: inherit; text-decoration: underline; }
.chat-media { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; background: var(--bg, #fff); color: var(--fg, #222); }
.chat-media[hidden] { display: none; }
.chat-media .cm-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border, rgba(127,127,127,.25)); }
.chat-media .cm-head b { flex: 1; }
.chat-media .cm-tabs { display: flex; gap: 4px; padding: 8px 12px 4px; }
.chat-media .cm-tabs button { flex: 1; border: 0; border-radius: 999px; padding: 8px 6px; font: inherit; font-size: 13.5px; font-weight: 600; background: rgba(127,127,127,.12); color: inherit; cursor: pointer; }
.chat-media .cm-tabs button[aria-selected="true"] { background: var(--accent, #6c5ce7); color: #fff; }
.chat-media .cm-body { flex: 1; overflow-y: auto; padding: 8px 12px 16px; }
.chat-media .cm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 4px; }
.chat-media .cm-grid button { position: relative; aspect-ratio: 1; border: 0; padding: 0; border-radius: 8px; overflow: hidden; background: rgba(127,127,127,.15); cursor: pointer; font-size: 26px; color: inherit; }
.chat-media .cm-grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chat-media .cm-grid .vid { position: absolute; bottom: 4px; left: 6px; font-size: 13px; color: #fff; text-shadow: 0 1px 2px #000; }
.chat-media .cm-row { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid var(--border, rgba(127,127,127,.18)); }
.chat-media .cm-row .ic { font-size: 22px; flex: none; }
.chat-media .cm-row .tx { flex: 1; min-width: 0; }
.chat-media .cm-row .tx b, .chat-media .cm-row .tx small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
.chat-media .cm-row .tx small { opacity: .7; font-size: 12px; }
.chat-media .cm-row a { color: inherit; }
.chat-media .cm-empty { opacity: .7; text-align: center; margin: 40px auto; max-width: 30ch; }
.chat-pick-list { display: flex; flex-direction: column; gap: 4px; margin: 10px 0 14px; }
.chat-pick-list button { display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border, rgba(127,127,127,.3)); border-radius: 12px; background: none; color: inherit; font: inherit; padding: 11px 14px; cursor: pointer; text-align: start; }
.chat-pick-list button[aria-checked="true"] { border-color: var(--accent, #6c5ce7); box-shadow: 0 0 0 1px var(--accent, #6c5ce7); font-weight: 600; }
.chat-pick-list button[aria-checked="true"]::after { content: "✓"; color: var(--accent, #6c5ce7); }
.chat-later-when { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chat-later-when button { border: 1px solid var(--border, rgba(127,127,127,.3)); border-radius: 999px; background: none; color: inherit; font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; }
.chat-later-dlg input[type=datetime-local] { width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border, rgba(127,127,127,.35)); background: transparent; color: inherit; font: inherit; }
@media (max-width: 380px) { .chat-head .icon-btn { width: 36px; height: 36px; } .chat-head .avatar { width: 34px; height: 34px; } }
`;
  let styled = false;
  const addStyle = () => {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
  };
  const REACTS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const EMOJI = ['😀', '😂', '🥹', '😊', '😍', '🥰', '😘', '😉', '😎', '🤩', '🤔', '🙄', '😴', '😅', '😭', '😢', '😡', '🥳', '😮', '🤯',
    '👍', '👎', '👏', '🙏', '🙌', '💪', '👋', '🤝', '✌️', '👌', '❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '🔥', '✨', '⭐',
    '🎉', '🎂', '🎁', '☕', '🍕', '⚽', '🎵', '📷', '📎', '📁', '💻', '📱', '✅', '❌', '⚠️', '💯', '👀', '🌙', '☀️', '🌹'];
  // A message that is only one to three emoji shows big, without a bubble (null where the browser lacks \p{…})
  const BIG_EMOJI = (() => { try { return new RegExp('^(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic}\\uFE0F?)*\\s*){1,3}$', 'u'); } catch { return null; } })();
  const ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', text: '📝', '': '📎' };
  const dayOf = (at) => new Date(at).toDateString();
  const dayLabel = (at) => {
    const d = new Date(at), now = new Date();
    if (d.toDateString() === now.toDateString()) return t('Today');
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return t('Yesterday');
    return d.toLocaleDateString(document.documentElement.lang || [], { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const timeOf = (at) => new Date(at).toLocaleTimeString(document.documentElement.lang || [], { hour: '2-digit', minute: '2-digit' });
  const results = () => ({ ok: '✓', declined: t('Declined'), failed: t('Not finished'), cancelled: t('Cancelled') });

  let current = null; // { who, dlg, urls, observer }
  const NOTIF_OFFER_KEY = 'omnibeam-chat-notif-offer';
  const offerAnswered = () => { try { localStorage.setItem(NOTIF_OFFER_KEY, '1'); } catch {} $('.chat-notif', current.dlg).hidden = true; };
  // Clear chat: asks first (in a small window); then the messages and file entries with this device go from this
  // device (Undo for 6 s). "Also delete it on {name}" asks the other device to delete its copy of this chat too: it
  // asks its owner there first (see askClearChat in app.js). A paired device that is offline gets the question when it
  // next opens OmniBeam while this page is open.
  function clear() {
    const name = $('#chat-title').textContent || current.who.name;
    const who = current.who;
    let dlg = document.getElementById('dlg-chat-clear');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-chat-clear';
      dlg.setAttribute('aria-labelledby', 'chat-clear-title');
      dlg.innerHTML = '<h3 id="chat-clear-title"></h3><p class="muted"></p><label class="chat-clear-both"><input type="checkbox"> <span></span></label>'
        + '<div class="row"><button type="button" class="btn ghost" data-act="no"></button><button type="button" class="btn danger" data-act="yes"></button></div>';
      document.body.appendChild(dlg);
    }
    const peer = peerOf(who);
    const pairing = pairingOf(who);
    $('h3', dlg).textContent = t('Clear chat');
    $('p', dlg).textContent = t('Clear this chat? Messages and file entries with {name} are removed from this device only.', { name });
    const both = $('.chat-clear-both', dlg);
    const box = $('input', both);
    both.hidden = !peer && !pairing;
    box.checked = false;
    $('span', both).textContent = t('Also delete it on {name} (asks there first)', { name });
    $('[data-act=no]', dlg).textContent = t('Cancel');
    $('[data-act=yes]', dlg).textContent = t('Clear chat');
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dlg.close();
      if (act !== 'yes') return;
      const askThere = !both.hidden && box.checked;
      clearChat(who);
      if (askThere) askOtherToClear(peer || pairing);
    };
    dlg.showModal();
    $('[data-act=no]', dlg).focus();
  }
  // Pinned notes: { thread key: { text, at } } on this device
  const PINS_KEY = 'omnibeam-pins';
  const pins = () => { try { return JSON.parse(localStorage.getItem(PINS_KEY)) || {}; } catch { return {}; } };
  const pinOf = (who) => pins()[chatKey(who)] || null;
  function setPin(who, text) {
    const all = pins();
    const key = chatKey(who);
    text = String(text || '').trim().slice(0, 2000);
    if (text) all[key] = { text, at: Date.now() };
    else delete all[key];
    try { localStorage.setItem(PINS_KEY, JSON.stringify(all)); } catch { toast(t('Could not save')); }
    if (text) wsSend({ type: 'stat', kind: 'pin' });
  }
  function pinNow(text) {
    const had = pinOf(current.who);
    setPin(current.who, text);
    toast(had ? t('Pinned note replaced') : t('Pinned at the top of this chat'));
    render(true);
  }
  function editPin() {
    const had = pinOf(current.who);
    const text = prompt(t('A note pinned at the top of this chat, on this device only (a Wi-Fi password, an address…):'), had ? had.text : '');
    if (text === null) return;
    if (!text.trim()) { if (had) { setPin(current.who, ''); toast(t('Note unpinned')); render(true); } return; }
    setPin(current.who, text);
    toast(t('Pinned at the top of this chat'));
    render(true);
  }
  function paintPin() {
    const box = $('.chat-pin', current.dlg);
    const pin = pinOf(current.who);
    box.hidden = !pin;
    if (!pin) return;
    $('.pin-text', box).textContent = pin.text;
  }
  function dialog() {
    let dlg = document.getElementById('dlg-chat');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-chat';
    dlg.className = 'chat-dialog';
    dlg.setAttribute('aria-labelledby', 'chat-title');
    dlg.innerHTML = `
      <div class="chat-head">
        <div class="avatar" aria-hidden="true"></div>
        <div class="chat-who"><b id="chat-title"></b><small class="chat-state"></small></div>
        <button type="button" class="icon-btn" data-act="call-voice" title="${escapeHtml(t('Voice call'))}" aria-label="${escapeHtml(t('Voice call'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg></button>
        <button type="button" class="icon-btn" data-act="call-video" title="${escapeHtml(t('Video call'))}" aria-label="${escapeHtml(t('Video call'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m23 7-7 5 7 5zM1 5h15v14H1z"/></svg></button>
        <button type="button" class="icon-btn" data-act="search" aria-expanded="false" title="${escapeHtml(t('Search in chat'))}" aria-label="${escapeHtml(t('Search in chat'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></button>
        <button type="button" class="icon-btn" data-act="head-more" aria-haspopup="menu" aria-expanded="false" title="${escapeHtml(t('More'))}" aria-label="${escapeHtml(t('More'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg></button>
        <button type="button" class="icon-btn" data-act="close" title="${escapeHtml(t('Close'))}" aria-label="${escapeHtml(t('Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="chat-head-menu" hidden role="menu" aria-label="${escapeHtml(t('More'))}">
        <button type="button" class="menu-item" role="menuitem" data-act="media"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>${escapeHtml(t('Media, files and links'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-act="later"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span>${escapeHtml(t('Send later'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-act="vanish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/></svg><span>${escapeHtml(t('Disappearing messages'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-act="ring"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg><span>${escapeHtml(t('Ring this device'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-act="pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg><span>${escapeHtml(t('Pin a note'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-act="sound" aria-pressed="true"></button>
        <button type="button" class="menu-item danger" role="menuitem" data-act="clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg><span>${escapeHtml(t('Clear chat'))}</span></button>
      </div>
      <div class="chat-search" hidden role="search">
        <input type="search" maxlength="100" aria-label="${escapeHtml(t('Search in chat'))}" placeholder="${escapeHtml(t('Search in chat'))}">
        <span class="n" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-act="hit-prev" title="${escapeHtml(t('Previous'))}" aria-label="${escapeHtml(t('Previous'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>
        <button type="button" class="icon-btn" data-act="hit-next" title="${escapeHtml(t('Next'))}" aria-label="${escapeHtml(t('Next'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <button type="button" class="icon-btn" data-act="search-x" title="${escapeHtml(t('Close search'))}" aria-label="${escapeHtml(t('Close search'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="chat-media" hidden role="region" aria-label="${escapeHtml(t('Media, files and links'))}">
        <div class="cm-head"><b>${escapeHtml(t('Media, files and links'))}</b><button type="button" class="icon-btn" data-act="media-x" title="${escapeHtml(t('Close'))}" aria-label="${escapeHtml(t('Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
        <div class="cm-tabs" role="tablist"><button type="button" role="tab" data-tab="media" aria-selected="true">${escapeHtml(t('Media'))}</button><button type="button" role="tab" data-tab="files" aria-selected="false">${escapeHtml(t('Files'))}</button><button type="button" role="tab" data-tab="links" aria-selected="false">${escapeHtml(t('Links'))}</button></div>
        <div class="cm-body" role="tabpanel"></div>
      </div>
      <div class="chat-pin" hidden><span class="pin-ico" aria-hidden="true">📌</span><div class="pin-text" title="${escapeHtml(t('Pinned note'))}"></div><div class="pin-acts"><button type="button" class="link-btn" data-act="pin-copy">${escapeHtml(t('Copy'))}</button><button type="button" class="link-btn" data-act="pin-edit">${escapeHtml(t('Edit'))}</button><button type="button" class="link-btn" data-act="unpin">${escapeHtml(t('Unpin'))}</button></div></div>
      <button type="button" class="chat-vanish" data-act="vanish" hidden><span aria-hidden="true">⏳</span><span class="v-text"></span></button>
      <div class="chat-thread" role="log" aria-live="polite" tabindex="0"></div>
      <p class="chat-note" hidden></p>
      <div class="chat-notif" hidden><span>${escapeHtml(t('Get a notification when a message arrives and this chat is not on screen?'))}</span><button type="button" class="btn ghost small" data-act="notif-no">${escapeHtml(t('Not now'))}</button><button type="button" class="btn small" data-act="notif-yes">${escapeHtml(t('Turn on notifications'))}</button></div>
      <div class="shrink-toggle" role="group" aria-label="${escapeHtml(t('Photos'))}">
        <span>${escapeHtml(t('Photos'))}</span>
        <button type="button" data-shrink="off" aria-pressed="true">${escapeHtml(t('Original'))}</button>
        <button type="button" data-shrink="photos" aria-pressed="false">${escapeHtml(t('Smaller'))}</button>
      </div>
      <div class="chat-replying" hidden><div><b></b><span></span></div><button type="button" class="icon-btn" data-act="reply-x" title="${escapeHtml(t('Cancel reply'))}" aria-label="${escapeHtml(t('Cancel reply'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="chat-emoji" hidden role="group" aria-label="${escapeHtml(t('Emoji'))}">${EMOJI.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div class="chat-compose">
        <button type="button" class="icon-btn" data-act="emoji" aria-expanded="false" title="${escapeHtml(t('Emoji'))}" aria-label="${escapeHtml(t('Emoji'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg></button>
        <textarea rows="1" maxlength="20000" aria-label="${escapeHtml(t('Message'))}" placeholder="${escapeHtml(t('Message'))}"></textarea>
        <button type="button" class="icon-btn" data-act="attach" title="${escapeHtml(t('Send files'))}" aria-label="${escapeHtml(t('Send files'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <button type="button" class="icon-btn round" data-act="send" title="${escapeHtml(t('Send'))}" aria-label="${escapeHtml(t('Send'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>
      </div>
      <div class="chat-menu" hidden role="menu" aria-label="${escapeHtml(t('Message options'))}">
        <div class="react-row" role="group" aria-label="${escapeHtml(t('Reactions'))}">${REACTS.map((e) => `<button type="button" data-react="${e}" aria-pressed="false" aria-label="${e}">${e}</button>`).join('')}</div>
        <button type="button" class="menu-item" role="menuitem" data-menu="reply"><span aria-hidden="true">↩️</span><span>${escapeHtml(t('Reply'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-menu="forward"><span aria-hidden="true">↪️</span><span>${escapeHtml(t('Forward'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-menu="translate"><span aria-hidden="true">🌐</span><span>${escapeHtml(t('Translate'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-menu="copy"><span aria-hidden="true">📋</span><span>${escapeHtml(t('Copy'))}</span></button>
        <button type="button" class="menu-item" role="menuitem" data-menu="pin"><span aria-hidden="true">📌</span><span>${escapeHtml(t('Pin'))}</span></button>
        <button type="button" class="menu-item danger" role="menuitem" data-menu="delete"><span aria-hidden="true">🗑️</span><span>${escapeHtml(t('Delete for me'))}</span></button>
      </div>`;
    document.body.appendChild(dlg);
    return dlg;
  }
  // The device of this thread if it's here now (a paired one is recognised by its pairing, others by name)
  function peerOf(who) {
    const here = [...peers.values()];
    return here.find((p) => who.pair && p.pairSecret?.startsWith(who.pair))
      || (who.peer && peers.get(who.peer.info.id) === who.peer ? who.peer : null)
      || (!who.pair ? here.find((p) => p.info.name === who.name) : null) || null;
  }
  const pairingOf = (who) => (who.pair ? loadPaired().find((p) => p.secret.startsWith(who.pair)) : null);

  // A picture of a received photo, read from storage when it scrolls into view
  function lazyThumb(img, load) {
    const show = async () => {
      const blob = await load();
      if (!blob || !current) return;
      const url = URL.createObjectURL(blob);
      current.urls.push(url);
      img.src = url;
    };
    if (!current.observer) {
      current.observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          current.observer.unobserve(e.target);
          e.target.loadThumb?.();
        }
      }, { root: $('.chat-thread', current.dlg), rootMargin: '200px' });
    }
    img.loadThumb = show;
    current.observer.observe(img);
  }
  // A photo fills its bubble; the time goes on the photo (see render)
  function photoBox(el, img) {
    const box = document.createElement('div');
    box.className = 'chat-photo';
    box.appendChild(img);
    el.appendChild(box);
    el.classList.add('photo');
  }
  function fileBubble(entry) {
    const el = document.createElement('div');
    if (entry.dir === 'in') {
      const f = entry.item;
      const load = () => History.blobOf(f).then((blob) => {
        if (blob) return blob;
        toast(t('This file is no longer available'));
        History.remove(f);
        return null;
      });
      const kind = previewKind(f);
      if (kind === 'image') {
        const img = document.createElement('img');
        img.className = 'chat-thumb';
        img.alt = f.name;
        img.loading = 'lazy';
        img.onclick = () => media('preview')(f, load).catch(() => {});
        photoBox(el, img);
        lazyThumb(img, () => History.blobOf(f));
      }
      const row = document.createElement('div');
      row.className = 'chat-file';
      row.innerHTML = `<span class="chat-icon" aria-hidden="true">${ICON[kind] || ICON['']}</span><span><span class="chat-name"></span><small></small></span>`;
      $('.chat-name', row).textContent = f.name.split('/').pop();
      $('small', row).textContent = formatSize(f.size);
      el.appendChild(row);
      const acts = document.createElement('div');
      acts.className = 'chat-acts';
      if (kind) acts.appendChild(previewButton(f, load));
      acts.appendChild(saveButton(f, load));
      el.appendChild(acts);
    } else {
      const e = entry.item;
      const files = e.files || [];
      const kept = sentFiles.get(e.id); // the files themselves, while this page stays open
      const first = kept && kept.length === 1 && previewKind(kept[0]) === 'image' ? kept[0] : null;
      if (first) {
        const img = document.createElement('img');
        img.className = 'chat-thumb';
        img.alt = first.name;
        const url = URL.createObjectURL(first);
        current.urls.push(url);
        img.src = url;
        photoBox(el, img);
      }
      const row = document.createElement('div');
      row.className = 'chat-file';
      const name = files.length === 1 && e.n === 1 ? files[0].name.split('/').pop()
        : t('{n} files', { n: e.n || files.length }) + ': ' + files.slice(0, 3).map((x) => x.name.split('/').pop()).join(', ') + ((e.n || 0) > 3 ? '…' : '');
      row.innerHTML = `<span class="chat-icon" aria-hidden="true">${ICON[files.length === 1 ? previewKind(files[0]) : ''] || ICON['']}</span><span><span class="chat-name"></span><small></small></span>`;
      $('.chat-name', row).textContent = name;
      $('small', row).textContent = formatSize(e.bytes || 0);
      el.appendChild(row);
      if (e.result && e.result !== 'ok') {
        const acts = document.createElement('div');
        acts.className = 'chat-acts';
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn small';
        again.textContent = t('Send again');
        again.onclick = () => resend(e);
        acts.appendChild(again);
        el.appendChild(acts);
      }
    }
    return el;
  }
  // The quote of the message a reply answers; tapping it shows that message
  function quoteEl(re) {
    const q = document.createElement('button');
    q.type = 'button';
    q.className = 'chat-quote';
    q.innerHTML = '<b></b><span></span>';
    $('b', q).textContent = re.mine ? t('You') : ($('#chat-title').textContent || current.who.name);
    $('span', q).textContent = re.text;
    q.onclick = (e) => {
      e.stopPropagation();
      const to = [...$('.chat-thread', current.dlg).querySelectorAll('.bubble[data-mid]')].find((b) => b.dataset.mid === re.id);
      if (!to) return;
      to.scrollIntoView({ block: 'center', behavior: 'smooth' });
      to.classList.remove('flash');
      void to.offsetWidth;
      to.classList.add('flash');
    };
    return q;
  }
  // A small card for the first link of a message: the site's letter, name and address (nothing is fetched)
  function linkCard(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.host.replace(/^www\./, '');
    const a = document.createElement('a');
    a.className = 'chat-link-card';
    a.href = u.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = '<span class="lc-ico" aria-hidden="true"></span><span class="lc-txt"><b></b><small></small></span>';
    const ico = $('.lc-ico', a);
    ico.textContent = host[0] || '🔗';
    ico.style.background = colorFor(host);
    $('b', a).textContent = host;
    $('small', a).textContent = linkLabel(u.href);
    return a;
  }
  function textBubble(entry) {
    const el = document.createElement('div');
    const text = entry.item.text;
    if (entry.item.fwd) {
      const f = document.createElement('span');
      f.className = 'chat-fwd';
      f.textContent = '↪ ' + t('Forwarded');
      el.appendChild(f);
    }
    if (entry.item.re) el.appendChild(quoteEl(entry.item.re));
    const p = document.createElement('div');
    p.className = 'msg-text';
    p.innerHTML = linkify(text);
    el.appendChild(p);
    const tr = entry.item.id && current.trans?.get(entry.item.id);
    if (tr) {
      const box = document.createElement('div');
      box.className = 'msg-trans';
      box.innerHTML = '<small></small><span></span>';
      $('small', box).textContent = '🌐 ' + t('Translated');
      $('span', box).textContent = tr;
      el.appendChild(box);
    }
    if (BIG_EMOJI && text.length <= 40 && BIG_EMOJI.test(text.trim())) el.classList.add('big-emoji');
    const first = (text.match(/https?:\/\/[^\s<]+/) || [])[0];
    const card = first && linkCard(first);
    if (card) el.appendChild(card);
    const link = entry.dir === 'in' && linkOnly(text);
    if (link) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn small chat-link-open';
      open.textContent = t('Open link');
      open.onclick = () => { if (!openLink(link)) toast(t('Your browser blocked the new tab. Tap the link itself instead.')); };
      el.appendChild(open);
    }
    return el;
  }
  function render(keepScroll) {
    if (!current) return;
    const { who, dlg } = current;
    const thread = $('.chat-thread', dlg);
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    const before = thread.scrollTop;
    History.sync();
    for (const u of current.urls) URL.revokeObjectURL(u);
    current.urls = [];
    current.observer?.disconnect();
    current.observer = null;
    thread.innerHTML = '';
    const items = chatItems(who);
    const peer = peerOf(who);
    const pairing = pairingOf(who);
    // Header: name and picture, online or when it was last seen
    const name = peer ? peer.info.name : pairing?.name || who.name;
    $('#chat-title').textContent = name;
    const av = $('.chat-head .avatar', dlg);
    av.style.background = colorFor(name);
    av.innerHTML = avatarHtml(peer ? peer.info.avatar : pairing?.avatar, peer ? peer.info.device : pairing?.device || '');
    $('.chat-state', dlg).textContent = peer ? t('Online now') : pairing?.seen ? t('Last seen {time}', { time: timeAgo(pairing.seen) }) : t('Offline');
    // What the box at the bottom can do now
    const canSend = !!peer || !!pairing;
    const note = $('.chat-note', dlg);
    note.hidden = !!peer;
    note.textContent = pairing ? t('{name} is offline. What you send now goes as soon as it opens OmniBeam (keep this page open).', { name })
      : t('{name} is not here right now. Open OmniBeam on it to send.', { name });
    for (const el of dlg.querySelectorAll('.chat-compose textarea, .chat-compose button')) el.disabled = !canSend;
    // The speaker: message sound on or off (the same as Settings -> Message sound)
    const sound = $('[data-act=sound]', dlg);
    const soundLabel = msgSound ? t('Mute message sound') : t('Turn message sound on');
    sound.setAttribute('aria-pressed', String(msgSound));
    sound.title = soundLabel;
    sound.setAttribute('aria-label', soundLabel);
    sound.innerHTML = (msgSound
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg>') + '<span></span>';
    $('span', sound).textContent = soundLabel;
    $('[data-act=clear]', dlg).disabled = !items.length;
    // Ring: the device here now, or a paired one that is offline (it rings when it opens OmniBeam)
    $('[data-act=ring]', dlg).hidden = !peer && !pairing;
    // Calls: with the device here now, in a browser with a microphone (not on a TV)
    const canCall = !!peer && !IS_TV && !!navigator.mediaDevices?.getUserMedia && 'RTCPeerConnection' in window;
    $('[data-act=call-voice]', dlg).hidden = $('[data-act=call-video]', dlg).hidden = !canCall;
    $('.chat-head-menu [data-act=later]', dlg).hidden = !canSend;
    $('.chat-head-menu [data-act=vanish]', dlg).hidden = !canSend && !Vanish.of(who);
    // Disappearing messages: a line under the head while the timer is on
    const vanish = Vanish.of(who);
    const vbar = $('.chat-vanish', dlg);
    vbar.hidden = !vanish;
    if (vanish) $('.v-text', vbar).textContent = t('Messages in this chat disappear after {time}', { time: Vanish.label(vanish) });
    paintPin();
    // Notifications were never allowed or refused: offer them here once (not when the page opens)
    let offered = true;
    try { offered = !!localStorage.getItem(NOTIF_OFFER_KEY); } catch {}
    $('.chat-notif', dlg).hidden = offered || !('Notification' in window) || Notification.permission !== 'default';
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = t('Nothing sent or received with {name} in the last {time} yet. Messages and files appear here.', { name, time: keepText() });
      thread.appendChild(empty);
    }
    let day = '';
    const res = results();
    const near = (x, y) => x && y && x.dir === y.dir && dayOf(x.at) === dayOf(y.at) && Math.abs(y.at - x.at) < 120000;
    items.forEach((entry, i) => {
      if (dayOf(entry.at) !== day) {
        day = dayOf(entry.at);
        const sep = document.createElement('div');
        sep.className = 'chat-day';
        sep.textContent = dayLabel(entry.at);
        thread.appendChild(sep);
      }
      const b = entry.kind === 'text' ? textBubble(entry) : fileBubble(entry);
      b.classList.add('bubble', entry.dir, entry.kind);
      // Close together from the same side: one group, the tail on its last bubble
      if (near(items[i - 1], entry)) b.classList.add('grp');
      if (near(entry, items[i + 1])) b.classList.add('more-next');
      else b.classList.add('tail');
      const it = entry.item;
      const mid = entry.kind === 'text' ? it.id : null;
      if (mid) b.dataset.mid = mid;
      b.chatEntry = entry;
      if (entry.dir === 'out' && it.result) b.classList.add(it.result);
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = timeOf(entry.at);
      if (entry.dir === 'out' && it.result) {
        if (it.result === 'ok') {
          // ✓ sent, ✓✓ arrived, blue ✓✓ read (files: ✓✓ once they arrived whole)
          const st = entry.kind === 'file' ? 'd' : it.st || 's';
          const tick = document.createElement('span');
          tick.className = 'tick ' + st;
          tick.textContent = st === 's' ? '✓' : '✓✓';
          const label = t(st === 'r' ? 'Read' : st === 'd' ? 'Delivered' : 'Sent');
          tick.title = label;
          tick.setAttribute('aria-label', label);
          tick.setAttribute('role', 'img');
          meta.appendChild(tick);
        } else meta.textContent += ' · ' + (res[it.result] || '');
      }
      const foot = document.createElement('div');
      foot.className = 'chat-foot';
      const acts = entry.kind === 'text' ? b.querySelector(':scope > .chat-acts') : null;
      if (acts) foot.appendChild(acts);
      const photo = b.querySelector('.chat-photo');
      if (photo) { meta.classList.add('on-photo'); photo.appendChild(meta); }
      else foot.appendChild(meta);
      if (foot.firstChild) b.appendChild(foot);
      // The reactions under it (this device's and the other's)
      const r = mid && Reactions.of(mid);
      if (r && (r.me || r.them)) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'chat-react';
        const both = r.me && r.them && r.me === r.them;
        pill.innerHTML = both ? '<span></span><span class="n">2</span>' : '<span></span>';
        pill.firstChild.textContent = both ? r.me : [r.them, r.me].filter(Boolean).join('');
        pill.setAttribute('aria-label', t('Reactions') + ': ' + [r.them, r.me].filter(Boolean).join(' '));
        pill.onclick = (e) => { e.stopPropagation(); openMenu(b); };
        b.appendChild(pill);
        b.classList.add('has-react');
      }
      // The small arrow that opens the message menu (on hover; long-press and right-click open it too)
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'bubble-more';
      more.textContent = '⌄';
      more.title = t('Message options');
      more.setAttribute('aria-label', t('Message options'));
      more.setAttribute('aria-haspopup', 'menu');
      more.onclick = (e) => { e.stopPropagation(); openMenu(b); };
      b.appendChild(more);
      thread.appendChild(b);
    });
    // Send later: what waits for its time, at the end
    for (const l of Later.of(who)) thread.appendChild(laterBubble(l));
    // Search: the matching words marked, the current one in view
    if (current.q) markHits(thread);
    // A transfer from this device waiting for an answer stays at the end of the thread
    if (current.ask) thread.appendChild(current.ask.el);
    // "typing…": three moving dots at the end
    if (current.typingUntil > Date.now()) {
      const dots = document.createElement('div');
      dots.className = 'chat-typing';
      dots.setAttribute('aria-label', t('typing…'));
      dots.innerHTML = '<i></i><i></i><i></i>';
      thread.appendChild(dots);
    }
    // ↓ New messages: what arrived while scrolled up
    const inCount = items.filter((x) => x.dir === 'in').length;
    if (!keepScroll || atEnd) current.newCount = 0;
    else if (inCount > (current.inCount || 0)) current.newCount = (current.newCount || 0) + inCount - (current.inCount || 0);
    current.inCount = inCount;
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'chat-jump';
    jump.dataset.act = 'jump';
    jump.setAttribute('aria-label', t('Go to the latest message'));
    thread.appendChild(jump);
    if (current.q && current.hits?.length) showHit(false);
    else if (!keepScroll || atEnd) thread.scrollTop = thread.scrollHeight;
    else thread.scrollTop = before;
    paintJump();
    paintTyping();
    // Read: tell the device these messages were seen (blue ticks there), once, while this chat is on screen
    if (peer && document.visibilityState === 'visible' && dlg.open && (peer.direct || peer.relayed)) {
      const ids = items.filter((x) => x.kind === 'text' && x.dir === 'in' && x.item.id && !x.item.loc && !x.item.rd).map((x) => x.item.id);
      if (ids.length && chatTell(peer, { t: 'seen', ids })) Messages.markSeen(ids);
    }
    markChatRead(who);
    updateShrinkUi();
  }
  // ---- ↓ New messages, "typing…" ----
  function paintJump() {
    const thread = $('.chat-thread', current.dlg);
    const jump = $('.chat-jump', thread);
    if (!jump) return;
    const far = thread.scrollHeight - thread.scrollTop - thread.clientHeight > 300;
    const n = current.newCount || 0;
    if (!far && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60) current.newCount = 0;
    jump.hidden = !(far || (current.newCount || 0) > 0);
    jump.textContent = '↓' + (n ? ' ' + t('{n} new messages', { n }) : '');
  }
  function paintTyping() {
    const el = $('.chat-state', current.dlg);
    if (current.typingUntil > Date.now()) {
      el.textContent = t('typing…');
      el.classList.add('typing');
    } else el.classList.remove('typing');
  }
  // The other device is typing (on), or stopped / sent it: shown for 6 s after its last keystroke
  function typing(peer, on) {
    if (!current || peerOf(current.who) !== peer) return;
    const was = current.typingUntil > Date.now();
    current.typingUntil = on ? Date.now() + 6000 : 0;
    clearTimeout(current.typingTimer);
    if (on) current.typingTimer = setTimeout(() => { if (current) render(true); }, 6100);
    if (was !== on) render(true);
  }
  // This device is typing: told at most every 3 s, and when the box is emptied
  function tellTyping(on) {
    const peer = peerOf(current.who);
    if (!peer) return;
    const now = Date.now();
    if (on && now - (current.toldTyping || 0) < 3000) return;
    if (!on && !current.toldTyping) return;
    current.toldTyping = on ? now : 0;
    chatTell(peer, { t: 'typing', on });
  }
  // ---- The round button: the paper clip while the box is empty, Send once there is text ----
  function paintSend() {
    const dlg = current.dlg;
    const has = !!$('.chat-compose textarea', dlg).value.trim();
    const send = $('[data-act=send]', dlg);
    const attach = $('[data-act=attach]', dlg);
    send.hidden = !has;
    attach.classList.toggle('round', !has);
  }
  // ---- Reply ----
  function replyTo(entry) {
    const it = entry.item;
    if (entry.kind !== 'text' || !it.id) return;
    current.reply = { id: it.id, text: it.text.slice(0, 160), mine: entry.dir === 'out' };
    const bar = $('.chat-replying', current.dlg);
    bar.hidden = false;
    $('b', bar).textContent = current.reply.mine ? t('You') : t('Replying to {name}', { name: $('#chat-title').textContent });
    $('span', bar).textContent = current.reply.text;
    const ta = $('.chat-compose textarea', current.dlg);
    ta.focus();
  }
  function cancelReply() {
    current.reply = null;
    $('.chat-replying', current.dlg).hidden = true;
  }
  // ---- The message menu: reactions, Reply, Copy, Pin, Delete for me ----
  function openMenu(b) {
    const entry = b.chatEntry;
    if (!entry || !current) return;
    const menu = $('.chat-menu', current.dlg);
    current.menuFor = entry;
    const isText = entry.kind === 'text';
    const mid = isText ? entry.item.id : null;
    const r = (mid && Reactions.of(mid)) || {};
    const row = $('.react-row', menu);
    row.hidden = !mid;
    for (const btn of row.children) btn.setAttribute('aria-pressed', String(r.me === btn.dataset.react));
    $('[data-menu=reply]', menu).hidden = !mid;
    $('[data-menu=copy]', menu).hidden = !isText;
    $('[data-menu=forward]', menu).hidden = isText ? !it_text(entry) : !(entry.dir === 'in' || sentFiles.has(entry.item.id));
    const tr = $('[data-menu=translate]', menu);
    tr.hidden = !(isText && entry.dir === 'in' && mid && self.Translator);
    $('span:last-child', tr).textContent = current.trans?.has(mid) ? t('Show original') : t('Translate');
    $('[data-menu=pin]', menu).hidden = !isText;
    menu.hidden = false;
    // Next to the bubble, inside the screen
    const box = b.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = box.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, box.top - h - 6);
    let left = entry.dir === 'out' ? box.right - w : box.left;
    left = Math.min(Math.max(8, left), vw - w - 8);
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    current.menuBubble = b;
    b.style.transform = 'scale(1.02)';
    (row.hidden ? $('.menu-item:not([hidden])', menu) : row.firstElementChild).focus({ preventScroll: true });
  }
  const it_text = (entry) => !!String(entry.item.text || '').trim();
  function closeMenu() {
    if (!current) return false;
    const menu = $('.chat-menu', current.dlg);
    if (menu.hidden) return false;
    menu.hidden = true;
    if (current.menuBubble) current.menuBubble.style.transform = '';
    current.menuBubble = null;
    return true;
  }
  async function react(entry, emoji) {
    const mid = entry.item.id;
    const was = (Reactions.of(mid) || {}).me;
    const e = was === emoji ? '' : emoji; // the same one again takes it away
    Reactions.set(mid, 'me', e);
    if (entry.item.loc) return; // from an older version: kept here only
    const peer = peerOf(current.who);
    if (!peer) return;
    try { await peer.connect(); peer.sendJson({ t: 'react', id: mid, e }); } catch {}
  }
  function menuAction(act) {
    const entry = current.menuFor;
    closeMenu();
    if (!entry) return;
    const it = entry.item;
    if (act === 'reply') replyTo(entry);
    else if (act === 'copy') navigator.clipboard.writeText(it.text).then(() => toast(t('Copied to clipboard')), () => toast(t('Could not copy')));
    else if (act === 'pin') pinNow(it.text);
    else if (act === 'forward') forward(entry);
    else if (act === 'translate') translate(entry);
    else if (act === 'delete') {
      if (entry.dir === 'in' && entry.kind === 'text') Messages.remove(it);
      else if (entry.dir === 'in') History.remove(it);
      else Sent.remove(it.id);
      toast(t('Deleted from this device'));
    }
  }
  // ---- The ⋮ menu of the head ----
  function headMenu(show) {
    const menu = $('.chat-head-menu', current.dlg);
    const btn = $('[data-act=head-more]', current.dlg);
    if (show === undefined) show = menu.hidden;
    if (!show && menu.hidden) return false;
    menu.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    if (show) $('.menu-item:not([hidden]):not(:disabled)', menu)?.focus({ preventScroll: true });
    return true;
  }
  // ---- Search in the chat: matching words marked, ↑ ↓ go from one to the next ----
  const reEscape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function markHits(thread) {
    const re = new RegExp(reEscape(current.q), 'gi');
    current.hits = [];
    for (const b of thread.querySelectorAll('.bubble')) {
      let hit = false;
      for (const box of b.querySelectorAll('.msg-text, .chat-name, .msg-trans span')) {
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n; (n = walker.nextNode());) nodes.push(n);
        for (const n of nodes) {
          const text = n.textContent;
          re.lastIndex = 0;
          if (!re.test(text)) continue;
          hit = true;
          const frag = document.createDocumentFragment();
          let last = 0;
          text.replace(re, (m, at) => {
            frag.append(text.slice(last, at));
            const mark = document.createElement('mark');
            mark.textContent = m;
            frag.append(mark);
            last = at + m.length;
            return m;
          });
          frag.append(text.slice(last));
          n.replaceWith(frag);
        }
      }
      if (hit) current.hits.push(b);
    }
    if (current.hitAt == null || current.hitAt >= current.hits.length) current.hitAt = current.hits.length - 1;
    paintHits();
  }
  function paintHits() {
    const n = $('.chat-search .n', current.dlg);
    const total = current.hits?.length || 0;
    n.textContent = !current.q ? '' : total ? `${current.hitAt + 1}/${total}` : t('No results');
    for (const el of current.dlg.querySelectorAll('[data-act=hit-prev], [data-act=hit-next]')) el.disabled = total < 2;
  }
  function showHit(smooth = true) {
    const hits = current.hits || [];
    for (const b of hits) b.classList.remove('hit-now');
    const b = hits[current.hitAt];
    if (!b) return;
    b.classList.add('hit-now');
    b.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    paintHits();
  }
  function openSearch(show) {
    const bar = $('.chat-search', current.dlg);
    bar.hidden = !show;
    $('[data-act=search]', current.dlg).setAttribute('aria-expanded', String(show));
    const input = $('input', bar);
    if (show) { input.focus(); return; }
    input.value = '';
    current.q = '';
    current.hits = null;
    current.hitAt = null;
    render(true);
  }
  // ---- Media, files and links: everything shared in this chat, in three tabs ----
  function mediaPanel(tab) {
    const box = $('.chat-media', current.dlg);
    box.hidden = false;
    current.mediaTab = tab || current.mediaTab || 'media';
    for (const b of box.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === current.mediaTab));
    const body = $('.cm-body', box);
    body.innerHTML = '';
    const items = chatItems(current.who).reverse(); // newest first
    const files = [];
    for (const e of items) {
      if (e.kind !== 'file') continue;
      if (e.dir === 'in') files.push({ f: e.item, at: e.at, load: () => History.blobOf(e.item), mine: false });
      else for (const f of sentFiles.get(e.item.id) || e.item.files || []) files.push({ f, at: e.at, load: f instanceof Blob ? () => Promise.resolve(f) : null, mine: true });
    }
    const isMedia = (x) => ['image', 'video'].includes(previewKind(x.f));
    const empty = (text) => { const p = document.createElement('p'); p.className = 'cm-empty'; p.textContent = text; body.appendChild(p); };
    if (current.mediaTab === 'media') {
      const list = files.filter((x) => isMedia(x) && x.load).slice(0, 200);
      if (!list.length) return empty(t('No photos or videos in this chat yet'));
      const grid = document.createElement('div');
      grid.className = 'cm-grid';
      for (const x of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', x.f.name.split('/').pop());
        b.textContent = previewKind(x.f) === 'video' ? '🎬' : '🖼️';
        b.onclick = () => media('preview')(x.f, x.load).catch(() => {});
        if (previewKind(x.f) === 'image') {
          x.load().then((blob) => {
            if (!blob || box.hidden) return;
            const url = URL.createObjectURL(blob);
            current?.urls.push(url);
            b.textContent = '';
            b.appendChild(Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' }));
          }).catch(() => {});
        } else b.insertAdjacentHTML('beforeend', '<span class="vid" aria-hidden="true">▶</span>');
        grid.appendChild(b);
      }
      body.appendChild(grid);
    } else if (current.mediaTab === 'files') {
      const list = files.filter((x) => !isMedia(x) || !x.load);
      if (!list.length) return empty(t('No files in this chat yet'));
      for (const x of list) {
        const row = document.createElement('div');
        row.className = 'cm-row';
        row.innerHTML = `<span class="ic" aria-hidden="true">${ICON[previewKind(x.f)] || ICON['']}</span><span class="tx"><b></b><small></small></span>`;
        $('b', row).textContent = x.f.name.split('/').pop();
        $('small', row).textContent = `${formatSize(x.f.size || 0)} · ${dayLabel(x.at)} · ${x.mine ? t('Sent') : t('Received')}`;
        if (!x.mine) row.appendChild(saveButton(x.f, x.load));
        body.appendChild(row);
      }
    } else {
      const links = [];
      for (const e of items) {
        if (e.kind !== 'text') continue;
        for (const url of e.item.text.match(/https?:\/\/[^\s<]+/g) || []) links.push({ url, at: e.at });
      }
      if (!links.length) return empty(t('No links in this chat yet'));
      for (const l of links.slice(0, 300)) {
        const card = linkCard(l.url);
        if (!card) continue;
        const row = document.createElement('div');
        row.className = 'cm-row';
        card.style.flex = '1';
        card.style.margin = '0';
        row.appendChild(card);
        body.appendChild(row);
      }
    }
  }
  // ---- Forward: a message or file to another device here ----
  async function forward(entry) {
    const it = entry.item;
    const peer = await chooseDevice();
    if (!peer || !peers.has(peer.info.id)) return;
    wsSend({ type: 'stat', kind: 'again' });
    if (entry.kind === 'text') return peer.sendText(it.text, { fwd: true });
    if (entry.dir === 'in') {
      const blob = await History.blobOf(it);
      if (!blob) return toast(t('This file is no longer available'));
      return peer.sendFiles([new File([blob], it.name.split('/').pop(), { type: blob.type || it.mime || '' })]);
    }
    const kept = sentFiles.get(it.id);
    if (kept) return peer.sendFiles(kept);
    toast(t('Choose the same files again: they are only kept while this page is open'), 5000);
  }
  // ---- Translate: the browser's own translator (on this device; Chrome and Edge have one), into the page's language ----
  const translators = new Map();
  async function translate(entry) {
    const it = entry.item;
    current.trans ||= new Map();
    if (current.trans.has(it.id)) { current.trans.delete(it.id); return render(true); }
    const T = self.Translator;
    if (!T) return toast(t('This browser can\'t translate messages. Try a recent Chrome or Edge on a computer.'), 5000);
    const target = String(window.I18N?.lang || document.documentElement.lang || 'en').slice(0, 2);
    const at = current;
    try {
      let source = '';
      if (self.LanguageDetector) {
        const det = await self.LanguageDetector.create();
        const [best] = await det.detect(it.text);
        if (best && best.confidence > 0.4) source = String(best.detectedLanguage || '').slice(0, 2);
      }
      if (!source || source === 'un') return toast(t('Could not tell which language this message is in'));
      if (source === target) return toast(t('This message is already in your language'));
      const key = source + '>' + target;
      let tr = translators.get(key);
      if (!tr) {
        const can = await T.availability({ sourceLanguage: source, targetLanguage: target });
        if (can === 'unavailable' || can === 'no') return toast(t('This browser can\'t translate this language yet'));
        if (can !== 'available' && can !== 'readily') toast(t('Getting the translator ready…'), 4000);
        tr = await T.create({ sourceLanguage: source, targetLanguage: target });
        translators.set(key, tr);
      }
      const out = await tr.translate(it.text);
      if (current !== at) return;
      current.trans.set(it.id, String(out));
      render(true);
    } catch {
      toast(t('Could not translate this message'));
    }
  }
  // ---- Disappearing messages: how long messages stay in this chat ----
  function pickVanish() {
    const who = current.who;
    const name = $('#chat-title').textContent || who.name;
    let dlg = document.getElementById('dlg-chat-vanish');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-chat-vanish';
      dlg.setAttribute('aria-labelledby', 'chat-vanish-title');
      dlg.innerHTML = '<h3 id="chat-vanish-title"></h3><p class="muted"></p><div class="chat-pick-list" role="radiogroup"></div><div class="row"><button type="button" class="btn ghost" data-act="no"></button></div>';
      document.body.appendChild(dlg);
    }
    $('h3', dlg).textContent = t('Disappearing messages');
    $('p', dlg).textContent = t('Messages and files in this chat are deleted from this device after this time. {name} is told and sets the same time.', { name });
    $('[data-act=no]', dlg).textContent = t('Close');
    const now = Vanish.of(who);
    const list = $('.chat-pick-list', dlg);
    list.innerHTML = '';
    for (const ms of VANISH_TIMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(ms === now));
      b.textContent = ms ? Vanish.label(ms) : t('Off');
      b.onclick = () => {
        dlg.close();
        if (ms === now) return;
        Vanish.set(who, ms);
        toast(ms ? t('Messages in this chat disappear after {time}', { time: Vanish.label(ms) }) : t('Disappearing messages are off'));
      };
      list.appendChild(b);
    }
    dlg.onclick = (e) => { if (e.target.closest('[data-act=no]')) dlg.close(); };
    dlg.showModal();
    $('[aria-checked=true]', list)?.focus();
  }
  // ---- Send later ----
  const whenText = (at) => (dayOf(at) === dayOf(Date.now()) ? timeOf(at) : `${dayLabel(at)} ${timeOf(at)}`);
  const localInput = (at) => { const d = new Date(at - new Date(at).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  function laterBubble(l) {
    const el = document.createElement('div');
    el.className = 'bubble out text later tail';
    el.dataset.later = l.id;
    const p = document.createElement('div');
    p.className = 'msg-text';
    const files = laterFiles.get(l.id) || [];
    p.textContent = [files.length ? '📎 ' + (files.length === 1 ? files[0].name : t('{n} files', { n: files.length })) : '', l.text].filter(Boolean).join('\n');
    el.appendChild(p);
    const foot = document.createElement('div');
    foot.className = 'chat-foot';
    foot.innerHTML = '<div class="chat-acts"><button type="button" class="link-btn" data-later-act="now"></button><button type="button" class="link-btn" data-later-act="cancel"></button></div><div class="chat-meta"></div>';
    $('[data-later-act=now]', foot).textContent = t('Send now');
    $('[data-later-act=cancel]', foot).textContent = t('Cancel');
    $('.chat-meta', foot).textContent = '🕒 ' + t('Scheduled for {time}', { time: whenText(l.at) });
    el.appendChild(foot);
    return el;
  }
  function scheduleLater() {
    const who = current.who;
    const ta = $('.chat-compose textarea', current.dlg);
    const text = ta.value.trim();
    let dlg = document.getElementById('dlg-chat-later');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-chat-later';
      dlg.className = 'chat-later-dlg';
      dlg.setAttribute('aria-labelledby', 'chat-later-title');
      dlg.innerHTML = '<h3 id="chat-later-title"></h3><p class="muted later-what"></p><div class="chat-later-when"></div>'
        + '<label class="field"><span class="later-label"></span><input type="datetime-local"></label><p class="muted small later-note"></p>'
        + '<div class="row"><button type="button" class="btn ghost" data-act="no"></button><button type="button" class="btn" data-act="yes"></button></div>';
      document.body.appendChild(dlg);
    }
    $('h3', dlg).textContent = t('Send later');
    $('.later-what', dlg).textContent = text ? t('This message goes at the time you pick: “{text}”', { text: text.length > 80 ? text.slice(0, 80) + '…' : text })
      : t('Write a message first, or choose files to send at the time you pick.');
    $('.later-label', dlg).textContent = t('Date and time');
    $('.later-note', dlg).textContent = t('Keep OmniBeam open on this device: it sends at that time.');
    $('[data-act=no]', dlg).textContent = t('Cancel');
    $('[data-act=yes]', dlg).textContent = text ? t('Schedule') : t('Choose files');
    const input = $('input', dlg);
    const now = new Date();
    input.min = localInput(Date.now());
    input.value = localInput(Date.now() + 3600000);
    const quick = $('.chat-later-when', dlg);
    quick.innerHTML = '';
    const at = (h, dayAdd) => { const d = new Date(); d.setDate(d.getDate() + dayAdd); d.setHours(h, 0, 0, 0); return d.getTime(); };
    const chips = [[t('In 1 hour'), Date.now() + 3600000]];
    if (now.getHours() < 19) chips.push([t('Tonight at {time}', { time: timeOf(at(20, 0)) }), at(20, 0)]);
    chips.push([t('Tomorrow at {time}', { time: timeOf(at(9, 1)) }), at(9, 1)]);
    for (const [label, when] of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => { input.value = localInput(when); };
      quick.appendChild(b);
    }
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'no') return dlg.close();
      const when = new Date(input.value).getTime();
      if (!(when > Date.now() + 15000)) { input.focus(); return toast(t('Pick a time in the future')); }
      dlg.close();
      const done = () => toast(t('Scheduled for {time}', { time: whenText(when) }));
      if (text) {
        Later.add(who, when, text);
        if (current && current.who === who) { ta.value = ''; ta.style.height = ''; cancelReply(); paintSend(); }
        done();
      } else {
        fileInput.onchange = () => {
          const files = [...fileInput.files];
          fileInput.value = '';
          if (!files.length) return;
          Later.add(who, when, '', files);
          done();
        };
        fileInput.click();
      }
    };
    dlg.showModal();
  }
  function resend(entry) {
    const peer = peerOf(current.who);
    if (!peer) return toast(t('{name} is not here right now. Open OmniBeam on it to send.', { name: current.who.name }));
    const files = sentFiles.get(entry.id);
    if (files) return peer.sendFiles(files);
    toast(t('Choose the same files again: they are only kept while this page is open'), 5000);
    pickFiles();
  }
  // One photo from the chat: the editor first (crop, rotate, draw, blur, or just Send); see edit.js
  const EDITABLE = /^image\/(jpeg|png|webp)$/;
  async function sendFilesNow(files) {
    if (!files.length || !current) return;
    if (files.length === 1 && EDITABLE.test(files[0].type) && files[0].size < 40 * 1048576 && !IS_TV) {
      const who = current.who;
      let edited = null;
      try { edited = await photoEdit('open')(files[0], $('#chat-title').textContent || who.name); } catch { edited = files[0]; }
      if (!edited || !current || current.who !== who) return;
      files = [edited];
    }
    const peer = peerOf(current.who);
    if (peer) return peer.sendFiles(files);
    const pairing = pairingOf(current.who);
    if (pairing) {
      sendWhenOnline(pairing, files);
      toast(t('{n} file(s) waiting to send', { n: files.length }));
    }
  }
  function pickFiles() {
    fileInput.onchange = () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      sendFilesNow(files);
    };
    fileInput.click();
  }
  function sendText() {
    const ta = $('.chat-compose textarea', current.dlg);
    const text = ta.value.trim();
    if (!text) return ta.focus();
    const peer = peerOf(current.who);
    if (peer) {
      peer.sendText(text, { re: current.reply });
      current.toldTyping = 0; // a message ends "typing…" there by itself
    } else {
      const pairing = pairingOf(current.who);
      if (!pairing) return;
      // A message for an offline paired device waits with any files already waiting (see sendWhenOnline)
      const w = waiting.get(pairing.secret);
      sendWhenOnline(pairing, w ? w.files : [], w?.text ? w.text + '\n\n' + text : text);
      toast(t('The message goes as soon as {name} opens OmniBeam.', { name: pairing.name }));
    }
    ta.value = '';
    ta.style.height = '';
    cancelReply();
    paintSend();
    ta.focus();
  }
  // draft: text put in the box, ready to send (Send again of a message)
  function open(who, draft) {
    addStyle();
    const dlg = dialog();
    current = { who, dlg, urls: [], observer: null };
    const ta = $('.chat-compose textarea', dlg);
    ta.value = typeof draft === 'string' ? draft : '';
    ta.oninput = (e) => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px';
      paintSend();
      if (e) tellTyping(!!ta.value.trim());
    };
    const thread = $('.chat-thread', dlg);
    thread.onscroll = () => { if (current) paintJump(); };
    // Long-press (phones) and right-click open the message menu; a swipe to the side answers the message
    let press = null;
    thread.oncontextmenu = (e) => {
      const b = e.target.closest('.bubble');
      if (!b || !b.chatEntry || e.target.closest('a, img')) return;
      e.preventDefault();
      openMenu(b);
    };
    thread.ontouchstart = (e) => {
      const b = e.target.closest('.bubble');
      if (!b || !b.chatEntry || e.touches.length !== 1) return;
      const p = e.touches[0];
      press = { b, x: p.clientX, y: p.clientY, dx: 0, timer: setTimeout(() => { if (press) { press.long = true; navigator.vibrate?.(15); openMenu(b); } }, 500) };
    };
    thread.ontouchmove = (e) => {
      if (!press) return;
      const p = e.touches[0];
      const dx = p.clientX - press.x, dy = p.clientY - press.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(press.timer); press.b.style.transform = ''; press = null; return; }
      if (Math.abs(dx) > 8) clearTimeout(press.timer);
      // Towards the middle of the chat only (right for received, left for sent; the other way in Arabic and Urdu)
      const rtl = getComputedStyle(thread).direction === 'rtl';
      const way = (press.b.classList.contains('in') ? 1 : -1) * (rtl ? -1 : 1);
      press.dx = Math.max(0, Math.min(80, dx * way));
      if (press.b.chatEntry.kind === 'text') press.b.style.transform = press.dx ? `translateX(${press.dx * way}px)` : '';
    };
    thread.ontouchend = () => {
      if (!press) return;
      clearTimeout(press.timer);
      const { b, dx, long } = press;
      press = null;
      if (!long) b.style.transform = '';
      if (dx > 55) replyTo(b.chatEntry);
    };
    dlg.oncancel = (e) => {
      // Esc closes the menus, the emoji panel, Media and search first
      if (closeMenu() || headMenu(false) || closeEmoji()) return e.preventDefault();
      if (!$('.chat-media', dlg).hidden) { $('.chat-media', dlg).hidden = true; return e.preventDefault(); }
      if (!$('.chat-search', dlg).hidden) { openSearch(false); e.preventDefault(); }
    };
    // Search: as the words are typed
    const search = $('.chat-search input', dlg);
    let searchTimer = 0;
    search.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (!current) return;
        current.q = search.value.trim();
        current.hitAt = null;
        render(true);
      }, 150);
    };
    search.onkeydown = (e) => {
      if (e.key !== 'Enter' || !current.hits?.length) return;
      e.preventDefault();
      current.hitAt = (current.hitAt - (e.shiftKey ? -1 : 1) + current.hits.length) % current.hits.length;
      showHit();
    };
    // Send later: a long press (or right-click) on Send, or ⋮ → Send later
    const sendBtn = $('[data-act=send]', dlg);
    let sendPress = 0;
    sendBtn.oncontextmenu = (e) => { e.preventDefault(); scheduleLater(); };
    sendBtn.ontouchstart = () => { sendPress = setTimeout(() => { sendPress = -1; navigator.vibrate?.(15); scheduleLater(); }, 600); };
    sendBtn.ontouchend = (e) => { if (sendPress === -1) e.preventDefault(); clearTimeout(sendPress); sendPress = 0; };
    ta.onkeydown = (e) => {
      // Enter sends on computers; Shift+Enter (and Enter on phones) is a new line
      if (e.key === 'Enter' && !e.shiftKey && !isPhone && !e.isComposing) { e.preventDefault(); sendText(); }
    };
    const emojiBox = $('.chat-emoji', dlg);
    const closeEmoji = () => {
      if (emojiBox.hidden) return false;
      emojiBox.hidden = true;
      $('[data-act=emoji]', dlg).setAttribute('aria-expanded', 'false');
      return true;
    };
    dlg.onclick = (e) => {
      // The ⋮ menu closes on any tap (its item still does its job below)
      if (!e.target.closest('[data-act=head-more]')) headMenu(false);
      const tab = e.target.closest('.chat-media [data-tab]');
      if (tab) return mediaPanel(tab.dataset.tab);
      const lat = e.target.closest('[data-later-act]');
      if (lat) {
        const id = lat.closest('[data-later]')?.dataset.later;
        const item = Later.all().find((x) => x.id === id);
        if (!item) return;
        if (lat.dataset.laterAct === 'cancel') { Later.remove(id); toast(t('Scheduled message cancelled')); }
        else if (!Later.go(item)) toast(t('{name} is not here right now. Open OmniBeam on it to send.', { name: $('#chat-title').textContent }));
        return;
      }
      const menu = $('.chat-menu', dlg);
      if (!menu.hidden) {
        const r = e.target.closest('[data-react]');
        const m = e.target.closest('[data-menu]');
        if (r) { const entry = current.menuFor; closeMenu(); if (entry) react(entry, r.dataset.react); }
        else if (m) menuAction(m.dataset.menu);
        else closeMenu();
        return;
      }
      const emo = e.target.closest('[data-emoji]');
      if (emo) {
        // At the cursor, keeping the box ready to type
        const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, start) + emo.dataset.emoji + ta.value.slice(end);
        const at = start + emo.dataset.emoji.length;
        ta.setSelectionRange(at, at);
        ta.oninput({});
        tellTyping(true);
        if (!isPhone) ta.focus();
        return;
      }
      if (!e.target.closest('.chat-emoji, [data-act=emoji]')) closeEmoji();
      if (e.target.closest('.pin-text')) return $('.chat-pin', dlg).classList.toggle('open');
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'head-more') headMenu();
      else if (act === 'search') openSearch($('.chat-search', dlg).hidden);
      else if (act === 'search-x') openSearch(false);
      else if (act === 'hit-prev' || act === 'hit-next') {
        if (!current.hits?.length) return;
        current.hitAt = (current.hitAt + (act === 'hit-next' ? 1 : -1) + current.hits.length) % current.hits.length;
        showHit();
      } else if (act === 'media') mediaPanel();
      else if (act === 'media-x') $('.chat-media', dlg).hidden = true;
      else if (act === 'vanish') pickVanish();
      else if (act === 'later') scheduleLater();
      else if (act === 'call-voice' || act === 'call-video') {
        const p = peerOf(current.who);
        if (p) calls('start')(p, act === 'call-video');
      } else if (act === 'clear') clear();
      else if (act === 'ring') { const p = peerOf(current.who); ringDevice(p || pairingOf(current.who)); }
      else if (act === 'pin' || act === 'pin-edit') editPin();
      else if (act === 'unpin') { setPin(current.who, ''); toast(t('Note unpinned')); render(true); }
      else if (act === 'pin-copy') { const pin = pinOf(current.who); if (pin) navigator.clipboard.writeText(pin.text).then(() => toast(t('Copied to clipboard')), () => toast(t('Could not copy'))); }
      else if (act === 'sound') {
        setMsgSound(!msgSound);
        toast(msgSound ? t('Message sound on') : t('Message sound off'));
        if (msgSound) { unlockAudio(); chime(); }
      } else if (act === 'notif-no') offerAnswered();
      else if (act === 'notif-yes') {
        offerAnswered();
        Promise.resolve(Notification.requestPermission()).then((p) => { if (p === 'granted') toast(t('Notifications are on')); }).catch(() => {});
      } else if (act === 'attach') pickFiles();
      else if (act === 'send') sendText();
      else if (act === 'emoji') {
        const show = emojiBox.hidden;
        emojiBox.hidden = !show;
        $('[data-act=emoji]', dlg).setAttribute('aria-expanded', String(show));
      } else if (act === 'reply-x') { cancelReply(); ta.focus(); }
      else if (act === 'jump') {
        const thr = $('.chat-thread', dlg);
        current.newCount = 0;
        thr.scrollTop = thr.scrollHeight;
        paintJump();
      }
    };
    // Files dropped on the chat go to that device
    dlg.ondragover = (e) => { e.preventDefault(); };
    dlg.ondrop = async (e) => {
      e.preventDefault();
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) sendFilesNow(files);
    };
    dlg.onclose = () => {
      // The close event comes a moment after closing: if a chat was opened again meanwhile (a message arrived just
      // then), it belongs to that one and must not be undone
      if (!current || dlg.open) return;
      // Closed while a transfer was waiting for an answer: ask in the usual window instead
      const pending = current.ask;
      if (pending) {
        current.ask = null;
        pending.peer.asking = null;
        Promise.resolve().then(() => askAccept(pending.peer, pending.files)).then(pending.resolve);
      }
      for (const u of current.urls) URL.revokeObjectURL(u);
      current.observer?.disconnect();
      clearTimeout(current.typingTimer);
      tellTyping(false);
      current = null;
    };
    $('.chat-replying', dlg).hidden = true;
    $('.chat-menu', dlg).hidden = true;
    $('.chat-head-menu', dlg).hidden = true;
    $('.chat-media', dlg).hidden = true;
    $('.chat-search', dlg).hidden = true;
    search.value = '';
    closeEmoji();
    render();
    if (!dlg.open) dlg.showModal();
    paintSend();
    if (ta.value) ta.oninput();
    if (!isPhone || ta.value) ta.focus();
  }
  // A device wants to send files while its chat is open: ask in the thread, not in a window over it
  function ask(peer, files) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'bubble in file chat-ask';
      el.innerHTML = '<div class="chat-file"><span class="chat-icon" aria-hidden="true">📥</span><span><span class="chat-name"></span><small></small></span></div>'
        + '<div class="chat-acts"><button type="button" class="btn ghost small" data-ask="decline"></button><button type="button" class="btn small" data-ask="accept"></button></div>';
      $('.chat-name', el).textContent = files.length === 1 ? files[0].name.split('/').pop() : t('{n} files', { n: files.length });
      $('small', el).textContent = formatSize(files.reduce((s, f) => s + f.size, 0));
      $('[data-ask=accept]', el).textContent = t('Accept');
      $('[data-ask=decline]', el).textContent = t('Decline');
      const pending = { peer, files, resolve, el };
      const finish = (ok) => {
        peer.asking = null;
        if (current && current.ask === pending) current.ask = null;
        el.remove();
        resolve(ok);
      };
      peer.asking = finish;
      el.onclick = (e) => {
        const a = e.target.closest('[data-ask]')?.dataset.ask;
        if (a) finish(a === 'accept');
      };
      current.ask = pending;
      const thread = $('.chat-thread', current.dlg);
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      $('[data-ask=accept]', el).focus({ preventScroll: true });
    });
  }
  window.Chat = {
    open,
    ask,
    // The chat with this device is open now
    typing,
    showing: (peer) => !!current && !!current.dlg.open && peerOf(current.who) === peer,
    refresh: () => render(true),
    get open_() { return !!current; },
  };
})();
