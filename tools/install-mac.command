#!/bin/sh
# OmniBeam for Mac: double-click this file in Finder. It adds "Send with OmniBeam" to the right-click menu
# (Quick Actions) for files, and "Send text with OmniBeam" to the Services menu for selected text.
# Needs Node.js (https://nodejs.org). If macOS says the file can't be opened: right-click it > Open > Open.
cd "$(dirname "$0")" || exit 1
NODE="$(command -v node || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -n 1)"
if [ -z "$NODE" ]; then
  echo "OmniBeam needs Node.js. Install it from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org"
  exit 1
fi
"$NODE" omnibeam-send.js --install-sendto
echo
echo "Pair your phone once: on the phone open omnibeam.site, tap the link button > Create a pairing code,"
printf "then type the 6-digit code here (or press Enter to skip): "
read -r CODE
if [ -n "$CODE" ]; then "$NODE" omnibeam-send.js --pair "$CODE"; fi
echo
echo "Done. You can close this window."
