OmniBeam for Windows
====================

Send files and clipboard text from this PC to your phone, from the taskbar
or the right-click "Send to" menu, without opening the browser.

1. Install Node.js 22 or newer from https://nodejs.org
2. Keep this folder somewhere permanent, for example Documents\OmniBeam.
3. Double-click install-tray.cmd. The OmniBeam icon appears next to the clock
   and starts with Windows from now on.

Pair your phone once:
- On the phone, open omnibeam.site, tap the link button, then
  "Create a pairing code".
- On the PC, right-click the tray icon > Pair with a phone, and type the code.
- On the phone, open the Pair screen again and tick "Trusted" next to the PC.

Send:
- Click the tray icon, pick files, choose the phone.
- Right-click the icon > Send clipboard text.
- Right-click the icon > Sync clipboard to paired phones: from then on,
  text you copy on the PC goes to the phone straight away (turn on
  Clipboard sync in OmniBeam > Settings on the phone too).
- Right-click files in File Explorer > Send to > OmniBeam
  (turn it on first: tray menu > Add to right-click "Send to",
  or double-click install-send-to.cmd).

The phone needs omnibeam.site open to receive. Files go through the
OmniBeam server end-to-end encrypted.

Files in this folder:
  omnibeam-tray.ps1     the tray icon
  install-tray.cmd      starts it and adds it to the Start menu and startup
  omnibeam-send.js      the sender (also works on its own: node omnibeam-send.js --help)
  install-send-to.cmd   adds OmniBeam to the right-click Send to menu
  omnibeam.ico          the icon

Help: https://omnibeam.site/send-files-from-windows-tray
