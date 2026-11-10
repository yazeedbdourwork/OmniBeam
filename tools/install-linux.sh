#!/bin/sh
# OmniBeam for Linux: adds "Send with OmniBeam" to the right-click menu of Files (Nautilus), Nemo, Caja,
# Dolphin and Thunar. Run it from a terminal:  sh install-linux.sh
# Needs Node.js 18 or newer (https://nodejs.org or your distribution's nodejs package). For the device chooser
# and notifications, install zenity (or kdialog on KDE) and notify-send (libnotify).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "OmniBeam needs Node.js 18 or newer: https://nodejs.org (or: sudo apt install nodejs)"
  exit 1
fi
node omnibeam-send.js --install-sendto || exit 1
echo
echo "Pair your phone once: on the phone open omnibeam.site, tap the link button > Create a pairing code,"
printf "then type the 6-digit code here (or press Enter to skip): "
read -r CODE
if [ -n "$CODE" ]; then node omnibeam-send.js --pair "$CODE"; fi
