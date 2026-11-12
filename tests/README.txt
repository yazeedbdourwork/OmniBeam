Automatic tests for OmniBeam
============================

Run them before every upload: double-click run-tests.cmd in the omni folder,
or in a terminal there:

  npm install                      (once)
  npx playwright install chromium  (once)
  npm test

They start their own OmniBeam server on port 3999 (data in tests/.data) and
open two browsers that find each other and send files, messages and clipboard
text, run the speed test, and check the pages in all five languages. A green
"passed" for every test means it's safe to upload; a red one names what broke.

  send.test.js      files direct and through the server, ZIP, messages, decline
  features.test.js  clipboard sync, speed test, command-line sender, Linux menu
  pages.test.js     home page and guides in 5 languages, sitemap
  upgrades.test.js  tour, QR pairing, notifications, iPhone Shortcut, Chrome extension
  simple.test.js    light first visit (parts load when needed), the ⋯ menu
  helpers.js        shared helpers

After uploading, live-check.cmd (tests/live.check.js with tests/live.config.js) runs a
similar check against the real omnibeam.site.
  resume.test.js    "file intact" badge, a damaged file is flagged, a transfer continues after the connection drops
  a11y.test.js      device cards work with the keyboard, every dialog has a name
  support.test.js   the Support links and the one-time thank-you note
  screen-lock.test.js  an iPhone's screen locks mid-transfer (the page is hidden, frozen for 20 s with the debugger,
                       its connections cut by the server's test-only /__test/socket): the transfer must continue by
                       itself after waking, both directions, direct and through the server, and after a reload.
                       Seconds from waking to the transfer moving again go to tests/.results/screen-lock.json.
                       Also: the keep-screen-on video, the experimental screen-off sound. LOCKED_MS=8000 locks shorter.
  load.test.js         brotli for pages and scripts, the early fetch of app.js and the language file

Measurements (not tests; see tools/perf): page-load.js (slow 4G + 4x slower processor, phone screen),
sizes.js (bytes of the home page and scripts), transfer-speed.js (100 MB direct and through the server).
  phone-move.test.js   Move to a new phone (encrypted backup file), notification buttons (Reply, Open chat, Save, Stop)
  album-browse.test.js event photo albums (guests add photos, everything encrypted, host tools, Save all ZIP, poster, limits),
                       Share a folder / Browse files (a paired phone looks in a computer's folder and takes files)
