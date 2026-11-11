// Auto-deploy from GitHub (.github/workflows/deploy.yml, AUTO-DEPLOY.md, tools/build-upload.js ONLY_FILES):
// a connection test that changes nothing, a check that CPANEL_APP_DIR is the OmniBeam app folder, only the
// changed files sent (the live commit kept in tmp/omnibeam-deployed-commit.txt), and putting an older commit live.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('workflow: connection test, folder check, only changed files, undo with an older commit', async () => {
  const wf = read('.github', 'workflows', 'deploy.yml');
  for (const k of ['Test the connection', 'Send everything', 'Put the changes live', 'commit:',
    "ref: ${{ inputs.commit || github.sha }}", 'fetch-depth: 0',
    'Fileman/list_files', "grep -qx 'server.js'", "grep -qx 'public'",
    'Fileman/get_file_content', 'omnibeam-deployed-commit.txt', 'git diff --name-only', 'ONLY_FILES=', 'SKIP=1',
    'needs: test', 'branches: [main]']) expect(wf, k).toContain(k);
  expect(wf).not.toMatch(/\t/);
  // The folder check comes before anything is uploaded, and the live commit is only recorded after the restart
  expect(wf.indexOf('Fileman/list_files')).toBeLessThan(wf.indexOf('Fileman/upload_files'));
  expect(wf.indexOf('file=restart.txt')).toBeLessThan(wf.indexOf('--data-urlencode "content=${COMMIT}"'));
  // Every step that changes the site is skipped for a connection test
  for (const step of ['Build the upload zip', 'Upload and unpack (cPanel API)', 'Upload (FTP)', 'Purge Cloudflare', 'Quick live check']) {
    const at = wf.indexOf(`- name: ${step}`);
    expect(at, step).toBeGreaterThan(0);
    expect(wf.slice(at, wf.indexOf('\n', wf.indexOf('if:', at))), step).toContain("env.MODE != 'Test the connection'");
  }
});

test('build-upload: ONLY_FILES keeps the listed files plus the ones always sent', async () => {
  const src = read('tools', 'build-upload.js');
  expect(src).toContain('process.env.ONLY_FILES');
  expect(src).toMatch(/always = \(r\) => r === 'server\.js' \|\| r === 'public\/sitemap\.xml' \|\| r\.startsWith\('public\/tools\/'\)/);
  // service-worker.js is added after the filter, so it is always in the zip
  expect(src.indexOf('if (only)')).toBeLessThan(src.indexOf("name: 'service-worker.js'"));
});

test('setup steps in plain words', async () => {
  const doc = read('AUTO-DEPLOY.md');
  for (const k of ['Manage API Tokens', 'CPANEL_HOST', 'CPANEL_USER', 'CPANEL_TOKEN', 'CPANEL_APP_DIR', 'Test the connection',
    'Required reviewers', 'Undo']) expect(doc, k).toContain(k);
  expect(read('DEPLOY.md')).toContain('AUTO-DEPLOY.md');
});
