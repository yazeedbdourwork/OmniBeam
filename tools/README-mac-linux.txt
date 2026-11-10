OmniBeam for Mac and Linux
==========================

Send files and text from this computer to your phone with a right-click,
without opening the browser.

1. Install Node.js from https://nodejs.org (Mac: the macOS installer;
   Linux: version 18 or newer, e.g. sudo apt install nodejs).
2. Mac: double-click install-mac.command. If macOS won't open it,
   right-click it > Open > Open.
   Linux: open a terminal in this folder and run: sh install-linux.sh
   (For the device chooser install zenity, or kdialog on KDE.)
3. The installer asks for a pairing code. On the phone, open omnibeam.site,
   tap the link button, then "Create a pairing code", and type the code.
   On the phone, open the Pair screen again and tick "Trusted" next to the
   computer, so its files arrive without asking.

Send:
- Mac: right-click files in Finder > Quick Actions > Send with OmniBeam.
  Selected text in any app: right-click > Services > Send text with OmniBeam.
  If they are missing: System Settings > Keyboard > Keyboard Shortcuts >
  Services, and tick them.
- Linux: right-click files > Scripts > Send with OmniBeam (Files, Nemo,
  Caja), or right-click > Send with OmniBeam (Dolphin, Thunar).
- From a terminal: node omnibeam-send.js photo.jpg   (--help for more)
- Clipboard: pbpaste | node omnibeam-send.js --clip -        (Mac)
             xclip -o -sel clip | node omnibeam-send.js --clip -   (Linux)
  puts the text on the clipboard of your paired phone if it has
  Clipboard sync on (OmniBeam > Settings). Bind it to a keyboard shortcut
  to send the clipboard with one key.

The phone needs omnibeam.site open to receive. Files go through the
OmniBeam server, end-to-end encrypted, so the server can't read them.

Remove it again: node omnibeam-send.js --uninstall

Files in this folder:
  omnibeam-send.js        the sender (node omnibeam-send.js --help)
  install-mac.command     Mac installer
  install-linux.sh        Linux installer
  ws/                     WebSocket library for Node.js older than 22 (MIT licence)

Help: https://omnibeam.site/send-files-from-mac-linux
