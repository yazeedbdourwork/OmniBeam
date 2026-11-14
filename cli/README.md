# OmniBeam command line

Send files between your devices from a terminal. To your phone, another computer, or anyone, by an encrypted link.
It works with the same devices and links as [omnibeam.site](https://omnibeam.site). Nothing to install on the other side: it just needs a browser.

```sh
npx omnibeam send build.zip          # to a phone or computer that has omnibeam.site open
npx omnibeam receive                 # wait for files from your phone, save them here
npx omnibeam link report.pdf         # an encrypted share link anyone can open
npx omnibeam get <link>              # download a share link
```

It needs Node.js 22 or newer and has no dependencies. To keep it installed: `npm install -g omnibeam`.

## Send

```sh
omnibeam send photo.jpg notes.md            # files
omnibeam send ./dist                        # a folder (its files arrive in a folder of the same name)
omnibeam send app.apk --to "Pixel"          # to one device (part of its name is enough)
omnibeam send --text "deploy finished ✓"    # a message
git log -1 | omnibeam send --text -         # a message from standard input
pg_dump mydb | omnibeam send - --as db.sql  # standard input, as a file
```

Devices on the same network show up by themselves, and so do remembered (paired) devices on any network. If there are
several, it asks which one (or use `--to`). If there are none, it opens a room and prints a link and QR code: scan it with
your phone, and the file goes as soon as the phone joins.

The other device is asked to accept, unless it marked this computer as **Trusted** (open Pair on it and tick Trusted
next to this computer after `omnibeam pair`).

## Receive

```sh
omnibeam receive                 # saves here, stops after one transfer
omnibeam receive -o ~/Downloads  # somewhere else
omnibeam receive --yes --keep    # accept without asking, keep running
```

This computer shows up on OmniBeam on the other devices on the network. It also prints a room link and QR code, so a
phone on mobile data can join and send. Each file shows `✓ intact` once it matches the sender's check. Files that are
already there are not overwritten: you get `photo (1).jpg`.

Without a terminal (in a script), transfers are declined unless you add `--yes`. Transfers from paired devices are
always accepted.

## Share by link

```sh
omnibeam link report.pdf                                # 24 hours, unlimited downloads
omnibeam link logs/ --expires 1h --downloads 1          # deleted after one download, or an hour
omnibeam link contract.pdf --pin 4821                   # the link also needs this PIN
tar czf - ./logs | omnibeam link - --as logs.tar.gz      # straight from a pipe
omnibeam link build.zip --json                          # {"url": …, "expires": …} for scripts
```

The link is the only thing printed on standard output, so `URL=$(omnibeam link file.zip)` works. Links hold up to
100 MB on omnibeam.site and last up to 7 days. To delete one early: `omnibeam unlink <id> --token <token>` (both are
printed when it's made, and in `--json`).

```sh
omnibeam get "https://omnibeam.site/d/…#…"              # saves the files here
omnibeam get "<link>" -o ~/Downloads                    # somewhere else
omnibeam get "<link>" -o - | tar xz                     # one file to standard output
omnibeam get "<link>" --list                            # what's in it, without downloading
```

Links made on the website work too. Put the link in quotes: the part after `#` is the key.

## Pair a device

```sh
omnibeam pair 123456     # on the phone: Pair > Create a pairing code
omnibeam paired          # remembered devices
omnibeam unpair "Pixel"  # forget one
omnibeam devices         # who can be reached right now
```

A paired device finds this computer on any network, not only the same Wi-Fi. Pairings are kept in
`~/.config/omnibeam/paired.json` (Windows: `%APPDATA%\OmniBeam\paired.json`), the same file as the OmniBeam Send to menu
and tray app use.

## Privacy

Everything is end-to-end encrypted. Files to a device go through the OmniBeam server's relay, encrypted with a key the
two devices agree on (ECDH P-256 and AES-256-GCM); the server only passes bytes it can't read. A browser can connect
straight to another browser, but Node.js has no WebRTC, so the command line always uses the relay. A browser sending
here first tries a direct connection, which takes a few seconds before it falls back to the relay. Share links
are encrypted before upload with a random key that is only in the link after `#`, and that part never reaches the
server.

## Options

| Option | |
| --- | --- |
| `--to <name>` | the device to send to |
| `--room <code>` | use this public room (5 letters), `--password` if it has one |
| `-o, --out <folder>` | where received or downloaded files go (`get -o -` writes to standard output) |
| `-y, --yes` | receive: accept without asking |
| `--keep` | receive: keep running after the first transfer |
| `--no-room` | receive: no room, only this network and paired devices |
| `--expires <time>` | link: `1h`, `24h` (default), `3d`, `7d` |
| `--downloads <n>` | link: deleted after `n` downloads |
| `--pin <digits>` | link: needs this PIN (4 to 8 digits); get: the PIN to open it |
| `--as <name>` | the file name for standard input (`-`) |
| `--json` | link, devices, paired: JSON on standard output |
| `--name <name>` | the name other devices see (default: this computer's name) |
| `--server <url>` | your own OmniBeam server (or set `OMNIBEAM_SERVER`) |
| `--no-qr` | don't print QR codes |

Exit status is 0 on success and 1 on any failure (declined, damaged, link gone…).

## License

GPL-3.0-or-later, like OmniBeam. `lib/qrcode.js` is qrcode-generator by Kazuhiko Arase (MIT).
Source: https://github.com/yazeedbdourwork/OmniBeam/tree/main/cli
