#!/usr/bin/env node
// OmniBeam from the command line: send files or a message to a device that has OmniBeam open.
//
//   node omnibeam-send.js photo.jpg report.pdf          send files (asks which device if there are several)
//   node omnibeam-send.js --to "Red Fox" photo.jpg      send to the device whose name contains "Red Fox"
//   node omnibeam-send.js --text "hello"                send a message
//   node omnibeam-send.js --code 123456 file.zip        use a pairing code (other network)
//   node omnibeam-send.js --room abcde file.zip         use a public room (add --password if it has one)
//   node omnibeam-send.js --install-sendto              add OmniBeam to the right-click menu: Windows "Send to",
//                                                       Mac Finder Quick Actions, Linux file managers
//   node omnibeam-send.js --uninstall                   remove it from the right-click menu again (Mac, Linux)
//   node omnibeam-send.js --pair 123456                 remember a phone: on it, tap Pair > Create a pairing code
//   node omnibeam-send.js --paired                      list remembered devices (--unpair "name" forgets one)
//   node omnibeam-send.js --list                        list the devices that can be reached now (JSON)
//   node omnibeam-send.js --clip "text"                 put text on the clipboard of every remembered device
//                                                       that has Clipboard sync on (--clip - reads it from input)
//
// Options: --server <url> (default https://omnibeam.site), --name <name shown to others>, --wait (keep the
// window open after an error; used by the tray app and the Send to menu), --gui (no terminal: ask and report
// with dialogs and notifications; used by the Mac and Linux right-click menus). --text - reads the message
// from input.
// Remembered devices (paired.json in %APPDATA%\OmniBeam or ~/.config/omnibeam) are found on any network, and
// a device that marked this computer as Trusted accepts its files without asking.
// Needs Node.js 18 or newer (22 or newer if the ws folder isn't next to this file). Files go through the OmniBeam server relay (the browser-to-browser direct
// connection needs WebRTC, which Node doesn't have), end-to-end encrypted like the browser version.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const nodeCrypto = require('crypto');
const subtle = (globalThis.crypto && globalThis.crypto.subtle) || (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle);

const CHUNK = 256 * 1024;
const MAX_BUFFERED = 4 * 1024 * 1024;
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.txt': 'text/plain', '.json': 'application/json', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function parseArgs(argv) {
  const opts = { server: 'https://omnibeam.site', files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--server') opts.server = val();
    else if (a === '--to') opts.to = val();
    else if (a === '--text') opts.text = val();
    else if (a === '--code') opts.code = val();
    else if (a === '--room') opts.room = val();
    else if (a === '--password') opts.password = val();
    else if (a === '--name') opts.name = val();
    else if (a === '--install-sendto' || a === '--install') opts.install = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--clip') opts.clip = val();
    else if (a === '--gui') opts.gui = true;
    else if (a === '--pair') opts.pair = val();
    else if (a === '--paired') opts.paired = true;
    else if (a === '--unpair') opts.unpair = val();
    else if (a === '--list') opts.list = true;
    else if (a === '--wait') opts.wait = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

let waitOnFail = false;
let gui = false;
function fail(msg) {
  console.error(`OmniBeam: ${msg}`);
  if (gui) { alertUser(msg); process.exit(1); }
  if (!waitOnFail || !process.stdin.isTTY) process.exit(1);
  console.error('Press Enter to close.');
  process.stdin.once('data', () => process.exit(1));
  process.stdin.resume();
}

// ---------- Remembered devices ----------
// The same pairing as in the browser: a long random secret shared by two devices. Both join the secret's room on
// the server, so they find each other on any network. Kept in a small file in the user's settings folder.
const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'OmniBeam')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'omnibeam');
const PAIRED_FILE = path.join(CONFIG_DIR, 'paired.json');
function loadPaired() {
  try {
    const list = JSON.parse(fs.readFileSync(PAIRED_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((p) => /^[0-9a-f]{64}$/.test(p.secret)) : [];
  } catch {
    return [];
  }
}
function savePaired(list) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PAIRED_FILE, JSON.stringify(list, null, 2));
}
// Proof that we share a pairing with a device, as pairProof() in public/app.js: lets it auto-accept our files
function pairProof(secret, from, to) {
  return nodeCrypto.createHmac('sha256', secret).update(`omnibeam-auto:${from}>${to}`).digest().subarray(0, 16).toString('hex');
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// ---------- Dialogs and notifications (--gui, for the Mac and Linux right-click menus) ----------
// Mac: AppleScript (osascript). Linux: zenity (GNOME and most others) or kdialog (KDE), notify-send.
const { spawnSync } = require('child_process');
const has = (cmd) => process.platform !== 'win32' && spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
// AppleScript gets the texts as arguments (argv), so nothing in them needs escaping
const osa = (lines, args) => spawnSync('osascript', [...lines.flatMap((l) => ['-e', l]), ...args], { encoding: 'utf8' });
function notifyUser(text) {
  if (!gui) return console.log(text);
  if (process.platform === 'darwin') osa(['on run argv', 'display notification (item 1 of argv) with title "OmniBeam"', 'end run'], [text]);
  else if (has('notify-send')) spawnSync('notify-send', ['-a', 'OmniBeam', '-i', 'document-send', 'OmniBeam', text]);
  else console.log(text);
}
function alertUser(text) {
  if (process.platform === 'darwin') osa(['on run argv', 'display alert "OmniBeam" message (item 1 of argv) as warning', 'end run'], [text]);
  else if (has('zenity')) spawnSync('zenity', ['--error', '--title=OmniBeam', '--no-markup', `--text=${text}`]);
  else if (has('kdialog')) spawnSync('kdialog', ['--title', 'OmniBeam', '--error', text]);
  else if (has('notify-send')) spawnSync('notify-send', ['-a', 'OmniBeam', '-u', 'critical', 'OmniBeam', text]);
}
// Pick one of the labels; returns its index, or -1
function chooseUser(prompt, labels) {
  let r;
  if (process.platform === 'darwin') {
    r = osa(['on run argv', `set r to choose from list argv with title "OmniBeam" with prompt "${prompt}" default items {item 1 of argv}`,
      'if r is false then return ""', 'return item 1 of r', 'end run'], labels);
    return labels.indexOf((r.stdout || '').trim());
  }
  if (has('zenity')) {
    r = spawnSync('zenity', ['--list', '--title=OmniBeam', `--text=${prompt}`, '--column=#', '--column=Device', '--hide-column=1',
      '--print-column=1', '--height=320', ...labels.flatMap((l, i) => [String(i), l])], { encoding: 'utf8' });
    return r.status === 0 && /^\d+/.test(r.stdout) ? Number(r.stdout.trim().split('|')[0]) : -1;
  }
  if (has('kdialog')) {
    r = spawnSync('kdialog', ['--title', 'OmniBeam', '--menu', prompt, ...labels.flatMap((l, i) => [String(i), l])], { encoding: 'utf8' });
    return r.status === 0 ? Number(r.stdout.trim()) : -1;
  }
  fail('Several devices found: install zenity, or choose one with --to "name"');
}

// ---------- Mac and Linux: the right-click menu ----------
// The installers copy this script (and the bundled ws library, for Node.js older than 22) into the settings
// folder, so the menu keeps working wherever the download was unpacked. Run the installer again after updating.
const APP_DIR = path.join(CONFIG_DIR, 'app');
function copyApp() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  const script = path.join(APP_DIR, 'omnibeam-send.js');
  if (path.resolve(__filename) !== script) fs.copyFileSync(__filename, script);
  const ws = path.join(__dirname, 'ws');
  if (fs.existsSync(ws) && path.resolve(ws) !== path.join(APP_DIR, 'ws')) fs.cpSync(ws, path.join(APP_DIR, 'ws'), { recursive: true });
  return script;
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mac: two Quick Actions (right-click in Finder > Quick Actions, and the Services menu of any app):
// "Send with OmniBeam" for files, "Send text with OmniBeam" for selected text.
const MAC_SERVICES = path.join(os.homedir(), 'Library', 'Services');
const MAC_ACTIONS = [
  { name: 'Send with OmniBeam', input: 'com.apple.Automator.fileSystemObject', send: ['NSFilenamesPboardType'], method: 1, args: '"$@"' },
  { name: 'Send text with OmniBeam', input: 'com.apple.Automator.text', send: ['NSStringPboardType'], method: 0, args: '--text -' },
];
function macWorkflow(action, command) {
  const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${body}
</plist>
`;
  const info = plist(`<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict><key>default</key><string>${xml(action.name)}</string></dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      ${action.method === 1 ? '<key>NSRequiredContext</key>\n      <dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>\n      ' : ''}<key>NSSendTypes</key>
      <array>${action.send.map((t) => `<string>${t}</string>`).join('')}</array>
    </dict>
  </array>
</dict>`);
  const uuid = () => nodeCrypto.randomUUID().toUpperCase();
  const doc = plist(`<dict>
  <key>AMApplicationBuild</key><string>523</string>
  <key>AMApplicationVersion</key><string>2.10</string>
  <key>AMDocumentVersion</key><string>2</string>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key><string>List</string>
          <key>Optional</key><true/>
          <key>Types</key><array><string>com.apple.cocoa.string</string></array>
        </dict>
        <key>AMActionVersion</key><string>2.0.3</string>
        <key>AMApplication</key><array><string>Automator</string></array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key><dict/>
          <key>CheckedForUserDefaultShell</key><dict/>
          <key>inputMethod</key><dict/>
          <key>shell</key><dict/>
          <key>source</key><dict/>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key><string>List</string>
          <key>Types</key><array><string>com.apple.cocoa.string</string></array>
        </dict>
        <key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key><string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key><string>${xml(command)}</string>
          <key>CheckedForUserDefaultShell</key><true/>
          <key>inputMethod</key><integer>${action.method}</integer>
          <key>shell</key><string>/bin/sh</string>
          <key>source</key><string></string>
        </dict>
        <key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
        <key>CFBundleVersion</key><string>2.0.3</string>
        <key>CanShowSelectedItemsWhenRun</key><false/>
        <key>CanShowWhenRun</key><true/>
        <key>Category</key><array><string>AMCategoryUtilities</string></array>
        <key>Class Name</key><string>RunShellScriptAction</string>
        <key>InputUUID</key><string>${uuid()}</string>
        <key>Keywords</key><array><string>Shell</string><string>Script</string></array>
        <key>OutputUUID</key><string>${uuid()}</string>
        <key>UUID</key><string>${uuid()}</string>
        <key>UnlocalizedApplications</key><array><string>Automator</string></array>
        <key>arguments</key><dict/>
        <key>isViewVisible</key><integer>1</integer>
        <key>location</key><string>309.000000:316.000000</string>
      </dict>
      <key>isViewVisible</key><integer>1</integer>
    </dict>
  </array>
  <key>connectors</key><dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>applicationBundleIDsByPath</key><dict/>
    <key>applicationPaths</key><array/>
    <key>inputTypeIdentifier</key><string>${action.input}</string>
    <key>outputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
    <key>presentationMode</key><integer>15</integer>
    <key>processesInput</key><integer>0</integer>
    <key>serviceInputTypeIdentifier</key><string>${action.input}</string>
    <key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
    <key>serviceProcessesInput</key><integer>0</integer>
    <key>systemImageName</key><string>NSActionTemplate</string>
    <key>useAutomaticInputType</key><integer>0</integer>
    <key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
  </dict>
</dict>`);
  return { info, doc };
}
function installMac(opts) {
  const script = copyApp();
  for (const action of MAC_ACTIONS) {
    const dir = path.join(MAC_SERVICES, `${action.name}.workflow`, 'Contents');
    fs.mkdirSync(dir, { recursive: true });
    const command = `${shq(process.execPath)} ${shq(script)} --gui --server ${shq(opts.server)} ${action.args}`;
    const { info, doc } = macWorkflow(action, command);
    fs.writeFileSync(path.join(dir, 'Info.plist'), info);
    fs.writeFileSync(path.join(dir, 'document.wflow'), doc);
  }
  // Make Finder see the new Quick Actions now rather than after the next login
  spawnSync('/System/Library/CoreServices/pbs', ['-update']);
  console.log(`Added "${MAC_ACTIONS[0].name}" and "${MAC_ACTIONS[1].name}" (${MAC_SERVICES}).`);
  console.log('In Finder, right-click files > Quick Actions > Send with OmniBeam.');
  console.log('If it is not listed: System Settings > Keyboard > Keyboard Shortcuts > Services (or Finder > Settings >');
  console.log('Extensions on older macOS) and tick it. Selected text: right-click > Services > Send text with OmniBeam.');
}

// Linux: a script in the file managers' Scripts menus (Files/Nautilus, Nemo, Caja), a Dolphin service menu and a
// Thunar custom action, all running one launcher.
const LINUX_MENU = 'Send with OmniBeam';
function linuxPlaces() {
  const home = os.homedir();
  const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return {
    scripts: [path.join(data, 'nautilus', 'scripts'), path.join(data, 'nemo', 'scripts'), path.join(config, 'caja', 'scripts')],
    dolphin: [path.join(data, 'kio', 'servicemenus'), path.join(data, 'kservices5', 'ServiceMenus')],
    thunar: path.join(config, 'Thunar', 'uca.xml'),
    launcher: path.join(CONFIG_DIR, 'omnibeam-send.sh'),
  };
}
function installLinux(opts) {
  const script = copyApp();
  const p = linuxPlaces();
  fs.writeFileSync(p.launcher, `#!/bin/sh\n# Sends the given files with OmniBeam (made by omnibeam-send.js --install-sendto)\nexec ${shq(process.execPath)} ${shq(script)} --gui --server ${shq(opts.server)} "$@"\n`, { mode: 0o755 });
  const done = [];
  // Files (Nautilus) and Nemo pass the selected files as arguments; only add where that file manager is installed
  const managers = [['nautilus', 'Files'], ['nemo', 'Nemo'], ['caja', 'Caja']];
  p.scripts.forEach((dir, i) => {
    if (!has(managers[i][0]) && !fs.existsSync(dir)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LINUX_MENU), `#!/bin/sh\nexec ${shq(p.launcher)} "$@"\n`, { mode: 0o755 });
    done.push(`${managers[i][1]}: right-click files > Scripts > ${LINUX_MENU}`);
  });
  if (has('dolphin') || has('kioclient') || has('kioclient5')) {
    for (const dir of p.dolphin) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'omnibeam.desktop'), [
        '[Desktop Entry]', 'Type=Service', 'MimeType=application/octet-stream;all/allfiles;', 'Actions=send;',
        'X-KDE-ServiceTypes=KonqPopupMenu/Plugin', 'X-KDE-Priority=TopLevel', '',
        '[Desktop Action send]', `Name=${LINUX_MENU}`, 'Icon=document-send', `Exec=${p.launcher} %F`, '',
      ].join('\n'), { mode: 0o755 });
    }
    done.push(`Dolphin: right-click files > ${LINUX_MENU}`);
  }
  if (has('thunar') || fs.existsSync(p.thunar)) {
    let uca = fs.existsSync(p.thunar) ? fs.readFileSync(p.thunar, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n';
    if (!uca.includes('omnibeam-send')) {
      const action = `<action>\n\t<icon>document-send</icon>\n\t<name>${LINUX_MENU}</name>\n\t<unique-id>omnibeam-send</unique-id>\n`
        + `\t<command>${xml(p.launcher)} %F</command>\n\t<description>Send to your phone with OmniBeam</description>\n\t<patterns>*</patterns>\n`
        + '\t<other-files/>\n\t<text-files/>\n\t<image-files/>\n\t<audio-files/>\n\t<video-files/>\n</action>\n';
      uca = uca.includes('</actions>') ? uca.replace('</actions>', `${action}</actions>`) : uca + action;
      fs.mkdirSync(path.dirname(p.thunar), { recursive: true });
      fs.writeFileSync(p.thunar, uca);
    }
    done.push(`Thunar: right-click files > ${LINUX_MENU} (restart Thunar first: thunar -q)`);
  }
  console.log(done.length ? `Added "${LINUX_MENU}":\n  ${done.join('\n  ')}` : 'No supported file manager found (Files, Nemo, Caja, Dolphin, Thunar).');
  console.log(`Any other app or a keyboard shortcut can run: ${p.launcher} <files>`);
  if (!has('zenity') && !has('kdialog')) console.log('Tip: install zenity so OmniBeam can ask which device to send to.');
}
function uninstall() {
  if (process.platform === 'darwin') {
    for (const a of MAC_ACTIONS) fs.rmSync(path.join(MAC_SERVICES, `${a.name}.workflow`), { recursive: true, force: true });
  } else if (process.platform !== 'win32') {
    const p = linuxPlaces();
    for (const dir of p.scripts) fs.rmSync(path.join(dir, LINUX_MENU), { force: true });
    for (const dir of p.dolphin) fs.rmSync(path.join(dir, 'omnibeam.desktop'), { force: true });
    if (fs.existsSync(p.thunar)) {
      const uca = fs.readFileSync(p.thunar, 'utf8').replace(/<action>(?:(?!<\/action>)[\s\S])*omnibeam-send(?:(?!<\/action>)[\s\S])*<\/action>\n?/g, '');
      fs.writeFileSync(p.thunar, uca);
    }
    fs.rmSync(p.launcher, { force: true });
  } else {
    fs.rmSync(path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'SendTo', 'OmniBeam.lnk'), { force: true });
  }
  console.log('Removed OmniBeam from the right-click menu.');
}

// Windows: add "OmniBeam" (with the OmniBeam icon) to the right-click "Send to" menu. The menu entry is a shortcut
// to a small OmniBeam.cmd kept in %APPDATA%\OmniBeam, which runs this script with the chosen files.
async function installSendTo(opts) {
  if (process.platform === 'darwin') return installMac(opts);
  if (process.platform !== 'win32') return installLinux(opts);
  const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'SendTo');
  if (!fs.existsSync(dir)) fail(`Could not find the Send to folder (${dir})`);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const cmd = path.join(CONFIG_DIR, 'OmniBeam.cmd');
  fs.writeFileSync(cmd, [
    '@echo off',
    `title OmniBeam`,
    `"${process.execPath}" "${path.resolve(__filename)}" --server "${opts.server}" %*`,
    'if errorlevel 1 (pause) else (timeout /t 3 >nul)',
    '',
  ].join('\r\n'));
  // The icon: omnibeam.ico next to this script, or the site's favicon
  const icon = path.join(CONFIG_DIR, 'omnibeam.ico');
  const localIcon = path.join(__dirname, 'omnibeam.ico');
  try {
    if (fs.existsSync(localIcon)) fs.copyFileSync(localIcon, icon);
    else if (!fs.existsSync(icon)) {
      const r = await fetch(new URL('/favicon.ico', opts.server));
      if (r.ok) fs.writeFileSync(icon, Buffer.from(await r.arrayBuffer()));
    }
  } catch {}
  const link = path.join(dir, 'OmniBeam.lnk');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:OB_LINK)',
    '$s.TargetPath = $env:OB_CMD',
    '$s.WorkingDirectory = $env:OB_DIR',
    '$s.Description = "Send to your phone with OmniBeam"',
    'if (Test-Path $env:OB_ICON) { $s.IconLocation = $env:OB_ICON + ",0" }',
    '$s.Save()',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, OB_LINK: link, OB_CMD: cmd, OB_DIR: CONFIG_DIR, OB_ICON: icon }, encoding: 'utf8', windowsHide: true,
  });
  if (r.status !== 0 || !fs.existsSync(link)) fail(`Could not create the shortcut: ${(r.stderr || r.error || '').toString().trim()}`);
  // Older versions put OmniBeam.cmd straight into the Send to folder (shown as "OmniBeam.cmd" with no icon)
  try { fs.unlinkSync(path.join(dir, 'OmniBeam.cmd')); } catch {}
  console.log(`Added "OmniBeam" to the Send to menu (${link}).`);
  console.log('Right-click any files > Send to > OmniBeam.');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function getWebSocket() {
  if (typeof WebSocket === 'function') return WebSocket;
  // Older Node: use the ws library bundled with the OmniBeam server, if this script sits next to it
  for (const p of [path.join(__dirname, 'ws'), path.join(__dirname, '..', 'vendor', 'ws'), 'ws']) {
    try { return require(p); } catch {}
  }
  fail('This needs Node.js 22 or newer (https://nodejs.org)');
}

// Everything on standard input (for --text - and --clip -)
function readStdin() {
  return new Promise((resolve) => {
    const parts = [];
    process.stdin.on('data', (d) => parts.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

// ---------- End-to-end encryption (same scheme as E2E in public/app.js) ----------
// The two devices agree on an AES-GCM key with ECDH through the server, which only sees the public keys.
async function e2eKeys() {
  if (!subtle) fail('This needs Node.js 22 or newer (https://nodejs.org)');
  const keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = Buffer.from(await subtle.exportKey('raw', keys.publicKey)).toString('base64');
  return { keys, pub };
}
async function e2eDerive(mine, theirPub, idA, idB) {
  const pub = await subtle.importKey('raw', Buffer.from(theirPub, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, mine.keys.privateKey, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: Buffer.from([idA, idB].sort().join('|')), info: Buffer.from('omnibeam-relay-v1') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, data, label) {
  const iv = nodeCrypto.randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(label) }, key, data);
  return Buffer.concat([iv, Buffer.from(ct)]);
}
async function open(key, data, label) {
  return Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: Buffer.from(label) }, key, data.subarray(12)));
}

// The usage text is the comment at the top of this file
const helpEnd = () => fs.readFileSync(__filename, 'utf8').split('\n').findIndex((l) => l.startsWith("'use strict'"));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  waitOnFail = !!opts.wait;
  gui = !!opts.gui;
  if (opts.text === '-') opts.text = (await readStdin()).replace(/\s+$/, '');
  if (opts.clip === '-') opts.clip = await readStdin();
  if (opts.uninstall) return uninstall();
  if (opts.paired) {
    const list = loadPaired();
    if (opts.list) return console.log(JSON.stringify(list.map(({ name, at }) => ({ name, at }))));
    if (!list.length) return console.log('No remembered devices. Pair one with --pair <code>.');
    for (const p of list) console.log(`  ${p.name} (paired ${new Date(p.at).toLocaleDateString()})`);
    return;
  }
  if (opts.unpair) {
    const want = opts.unpair.toLowerCase();
    const list = loadPaired();
    const left = list.filter((p) => !p.name.toLowerCase().includes(want));
    if (left.length === list.length) fail(`No remembered device called "${opts.unpair}"`);
    savePaired(left);
    return console.log(`Forgot ${list.length - left.length} device${list.length - left.length > 1 ? 's' : ''}.`);
  }
  if (opts.pair) opts.code = opts.pair;
  if (opts.help || (!opts.install && !opts.files.length && !opts.text && !opts.pair && !opts.list && !opts.clip)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, helpEnd()).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.install) return installSendTo(opts);

  const files = opts.files.map((f) => {
    let st;
    try { st = fs.statSync(f); } catch { fail(`File not found: ${f}`); }
    if (!st.isFile()) fail(`Not a file (folders can't be sent yet): ${f}`);
    return { path: f, name: path.basename(f), size: st.size, mime: MIME[path.extname(f).toLowerCase()] || '' };
  });

  const mine = await e2eKeys();
  const WS = getWebSocket();
  const base = new URL(opts.server);
  const wsUrl = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/ws`;
  const ws = new WS(wsUrl);
  ws.binaryType = 'arraybuffer';

  const peers = new Map(); // id -> { id, name, device }
  let target = null;
  let relayHandler = null; // messages from the target device
  let joinedRoom = !opts.code && !opts.room;
  let peersReady = null;
  const peersSettled = new Promise((resolve) => (peersReady = resolve));

  const send = (obj) => ws.send(JSON.stringify(obj));
  let myId = null;
  let e2e = null; // { key, tx, rx } once the target's public key arrived
  let gotKey = null;
  let keyReady = new Promise((resolve) => (gotKey = resolve));
  const helloFrom = new Set(); // devices that proved they share one of our pairings (pairHello)
  const relay = async (obj) => {
    const data = await seal(e2e.key, Buffer.from(JSON.stringify(obj)), `${myId}>${target.id}:${e2e.tx++}:t`);
    send({ type: 'relay', to: target.id, data: 'E1:' + data.toString('base64') });
  };
  let rxChain = Promise.resolve();

  let done = false;
  const pairPartners = new Set();
  let pairDone = null;
  const paired = new Promise((resolve) => (pairDone = resolve));
  ws.onerror = () => fail(`Could not connect to ${opts.server}`);
  ws.onclose = () => { if (!done) fail('Connection to the server closed'); };

  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'hello':
        myId = msg.id;
        send({ type: 'intro', device: `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || 'Computer'} command line`, name: opts.name || os.hostname() });
        if (loadPaired().length) send({ type: 'join-secrets', secrets: loadPaired().map((p) => p.secret) });
        if (opts.code) send({ type: 'join-code', code: String(opts.code).replace(/\D/g, '') });
        if (opts.room) {
          const code = String(opts.room).toLowerCase();
          const pass = opts.password ? nodeCrypto.createHash('sha256').update(`omnibeam-room:${code}:${opts.password}`).digest('hex') : undefined;
          send({ type: 'join-public', code, pass });
        }
        break;
      case 'peers':
        msg.peers.forEach((p) => peers.set(p.id, p));
        if (joinedRoom) setTimeout(peersReady, 300);
        break;
      case 'peer-joined':
        peers.set(msg.peer.id, msg.peer);
        break;
      case 'peer-left':
        peers.delete(msg.id);
        if (target && msg.id === target.id && !done) fail(`${target.name} went away`);
        break;
      case 'joined-code':
      case 'joined-public':
        joinedRoom = true;
        // Give devices already waiting in the room a moment to be listed
        setTimeout(peersReady, 800);
        break;
      case 'code-partner':
        pairPartners.add(msg.id);
        break;
      case 'code-error':
        fail(msg.reason);
        break;
      case 'public-error':
        fail({ full: 'That public room is full', password: 'This room needs a password (--password)', 'wrong-password': 'Wrong password' }[msg.reason]
          || 'Too many attempts. Wait a few minutes and try again.');
        break;
      case 'relay':
        if (target && msg.from === target.id && e2e && String(msg.data).startsWith('E1:')) {
          // Decrypt in arrival order
          rxChain = rxChain.then(async () => {
            const plain = await open(e2e.key, Buffer.from(String(msg.data).slice(3), 'base64'), `${target.id}>${myId}:${e2e.rx++}:t`);
            if (relayHandler) relayHandler(JSON.parse(plain.toString()));
          }).catch(() => fail('Secure connection failed'));
        }
        break;
      case 'signal':
        // --pair: the phone that created the code sends the pairing secret
        if (opts.pair && msg.data && /^[0-9a-f]{64}$/.test(msg.data.pairSecret || '') && pairPartners.has(msg.from)) {
          const who = peers.get(msg.from);
          const name = (who && who.name) || String(msg.data.name || 'Paired device').slice(0, 40);
          savePaired([...loadPaired().filter((p) => p.secret !== msg.data.pairSecret), { secret: msg.data.pairSecret, name, at: Date.now() }]);
          send({ type: 'signal', to: msg.from, data: { pairSaved: true } });
          send({ type: 'join-secrets', secrets: [msg.data.pairSecret] });
          send({ type: 'leave-code' });
          pairDone(name);
          break;
        }
        if (msg.data && msg.data.pairHello) {
          const mineProofs = new Set(loadPaired().map((p) => pairProof(p.secret, msg.from, myId)));
          if ([].concat(msg.data.pairHello).some((x) => mineProofs.has(x))) helloFrom.add(msg.from);
        }
        if (!target || msg.from !== target.id || !msg.data) break;
        if (msg.data.abort) fail(`Stopped on ${target.name}: ${msg.data.abort}`);
        if (typeof msg.data.e2e === 'string') {
          if (!msg.data.reply) send({ type: 'signal', to: target.id, data: { e2e: mine.pub, reply: true } });
          if (!e2e) e2eDerive(mine, msg.data.e2e, myId, target.id).then((key) => { e2e = { key, tx: 0, rx: 0 }; gotKey(); }, () => fail('Secure connection failed'));
        }
        break;
    }
  };

  if (opts.pair) {
    console.log('Waiting for the phone… (it must have created this code: Pair > Create a pairing code)');
    const timer = setTimeout(() => fail('The other device did not answer. Create a new code on it and try again.'), 60000);
    const name = await paired;
    clearTimeout(timer);
    console.log(`Paired with ${name}. It now finds this computer on any network.`);
    console.log(`Tip: on ${name}, open Pair and tick "Trusted" next to this computer, so its files arrive without asking.`);
    done = true;
    ws.close();
    setTimeout(() => process.exit(0), opts.wait ? 2500 : 200);
    return;
  }

  await peersSettled;
  // Wait a little longer when nobody is there yet (e.g. the other device is still connecting)
  for (let i = 0; i < 20 && !peers.size; i++) await new Promise((r) => setTimeout(r, 250));
  const list = [...peers.values()];
  if (opts.list) {
    console.log(JSON.stringify(list.map(({ name, device }) => ({ name, device }))));
    done = true;
    ws.close();
    setTimeout(() => process.exit(0), opts.wait ? 2500 : 200);
    return;
  }
  // --clip: to every remembered device that's online (they said hello with a pairing proof). Each one only puts
  // it on its clipboard if Clipboard sync is on there; otherwise it shows it as a message.
  if (opts.clip) {
    if (!loadPaired().length) fail('No remembered devices. Pair one first with --pair <code>.');
    await new Promise((r) => setTimeout(r, 1500)); // pairHello arrives just after the device list
    const targets = list.filter((p) => helloFrom.has(p.id));
    if (!targets.length) fail('None of your paired devices has OmniBeam open right now.');
    for (const p of targets) {
      target = p;
      e2e = null;
      keyReady = new Promise((resolve) => (gotKey = resolve));
      send({ type: 'signal', to: p.id, data: { e2e: mine.pub } });
      const ok = await Promise.race([keyReady.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
      if (!ok) continue;
      const proofs = loadPaired().map((x) => pairProof(x.secret, myId, p.id));
      await relay({ t: 'clip', text: opts.clip.slice(0, 100000), proofs });
      console.log(`Clipboard sent to ${p.name}`);
    }
    done = true;
    while (ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
    setTimeout(() => process.exit(0), 200);
    return;
  }
  if (!list.length) fail('No devices found. Open OmniBeam on the other device (same network, or use --code / --room).');

  if (opts.to) {
    const want = opts.to.toLowerCase();
    const matches = list.filter((p) => p.name.toLowerCase().includes(want));
    if (matches.length !== 1) fail(matches.length ? `Several devices match "${opts.to}": ${matches.map((p) => p.name).join(', ')}` : `No device called "${opts.to}". Found: ${list.map((p) => p.name).join(', ')}`);
    target = matches[0];
  } else if (list.length === 1) {
    target = list[0];
  } else if (gui) {
    target = list[chooseUser('Send to which device?', list.map((p) => `${p.name} (${p.device})`))];
    if (!target) process.exit(0); // cancelled
  } else {
    list.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.device})`));
    const n = Number(await ask('Send to which device? Number: '));
    target = list[n - 1];
    if (!target) fail('No device chosen');
  }

  const fromTarget = () => new Promise((resolve) => (relayHandler = resolve));
  // Remembered devices: say which pairing we share (keeps our name up to date there) and prove it with each send
  const proofs = loadPaired().map((p) => pairProof(p.secret, myId, target.id));
  if (proofs.length) send({ type: 'signal', to: target.id, data: { pairHello: proofs } });
  // Agree on the encryption key first
  send({ type: 'signal', to: target.id, data: { e2e: mine.pub } });
  const timeout = setTimeout(() => fail(`${target.name} did not answer (it may need to reload OmniBeam)`), 15000);
  await keyReady;
  clearTimeout(timeout);

  if (opts.text) {
    await relay({ t: 'text', text: opts.text });
    notifyUser(`Message sent to ${target.name}`);
  }

  if (files.length) {
    const total = files.reduce((s, f) => s + f.size, 0);
    notifyUser(`Asking ${target.name} to accept ${files.length} file${files.length > 1 ? 's' : ''} (${formatSize(total)})…`);
    await relay({ t: 'request', files: files.map(({ name, size, mime }) => ({ name, size, mime })), proofs });
    for (;;) {
      const m = await fromTarget();
      if (m.t === 'decline') fail(`${target.name} declined`);
      if (m.t === 'accept') break;
    }

    // From here on, show the receiver's progress and finish when it confirms
    let got = 0;
    let finished = null;
    const confirmed = new Promise((resolve) => (finished = resolve));
    relayHandler = (m) => {
      if (m.t === 'progress') got = Number(m.got) || got;
      if (m.t === 'received') finished();
    };
    const started = Date.now();
    const showProgress = () => {
      const secs = (Date.now() - started) / 1000;
      const pct = total ? Math.floor((got / total) * 100) : 100;
      process.stdout.write(`\r  ${pct}%  ${formatSize(got)} / ${formatSize(total)}  ${secs > 1 ? formatSize(got / secs) + '/s' : ''}   `);
    };
    const timer = gui ? null : setInterval(showProgress, 300);

    const header = Buffer.from(target.id, 'latin1');
    for (const f of files) {
      await relay({ t: 'file', name: f.name, size: f.size, mime: f.mime });
      const stream = fs.createReadStream(f.path, { highWaterMark: CHUNK });
      for await (const chunk of stream) {
        while (ws.bufferedAmount > MAX_BUFFERED) await new Promise((r) => setTimeout(r, 20));
        ws.send(Buffer.concat([header, await seal(e2e.key, chunk, `${myId}>${target.id}:${e2e.tx++}:b`)]));
      }
    }
    await relay({ t: 'done' });
    await confirmed;
    got = total;
    clearInterval(timer);
    if (!gui) {
      showProgress();
      process.stdout.write('\n');
    }
    notifyUser(`Sent ${files.length} file${files.length > 1 ? 's' : ''} to ${target.name}`);
  }

  done = true;
  // Let the last messages leave before closing
  while (ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 20));
  ws.close();
  setTimeout(() => process.exit(0), opts.wait ? 2500 : 200);
}

main().catch((err) => fail(err.message || String(err)));
