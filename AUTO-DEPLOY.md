# Auto-update omnibeam.site from GitHub

When this is set up, every change that lands on `main` goes live by itself. GitHub runs all the tests, sends
only the files that changed to cPanel, restarts the app, purges Cloudflare and checks that the live site is
on the new version. You no longer need zips, File Manager or the Restart button.

You set it up once. It takes about 10 minutes.

## 1. Make a cPanel API token

1. Log in to cPanel.
2. Go to **Security → Manage API Tokens → Create**.
3. Name: `github-deploy`. Expiry: whatever you like (no expiry is easiest; one year is safer).
4. Click **Create** and **copy the token right away**. cPanel shows it only once.

## 2. Find three more values in cPanel

| Secret name      | Where to find it |
|------------------|------------------|
| `CPANEL_USER`    | Your cPanel username (cPanel home page → **General Information → Current User**). |
| `CPANEL_HOST`    | The server's name (cPanel home page → **General Information → Server Name**, or the address you log in to cPanel at, without `https://` and `:2083`). Don't use `omnibeam.site` itself, because Cloudflare is in front of it. |
| `CPANEL_APP_DIR` | **Setup Node.js App** → the OmniBeam app → **Application root**, written as a full path: `/home/<your username>/<application root>`, for example `/home/abc123/omnibeam`. |

## 3. Put them in GitHub

GitHub → the **omnibeam** repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add these four, one at a time:

- `CPANEL_HOST`
- `CPANEL_USER`
- `CPANEL_TOKEN` (the token from step 1)
- `CPANEL_APP_DIR`

You can also add two optional secrets, so Cloudflare's cache is cleared after each update:

- `CLOUDFLARE_ZONE`: Cloudflare → omnibeam.site → **Overview** → **Zone ID** (right side).
- `CLOUDFLARE_TOKEN`: Cloudflare → **My Profile → API Tokens → Create Token → Custom token** with the
  permission **Zone → Cache Purge → Purge**, for the zone omnibeam.site.

## 4. Test it (changes nothing)

GitHub → **Actions → Deploy → Run workflow** → What to do: **Test the connection** → **Run workflow**.

After about a minute it turns green with "Connection works". If it turns red, open it. The red line says
which value is wrong.

The test also checks that `CPANEL_APP_DIR` really is the OmniBeam folder (it must hold `server.js` and
`public`), so files can never be unpacked into the wrong folder.

## 5. First real run

**Actions → Deploy → Run workflow** → **Put the changes live**.

The first time, it sends the whole site (about 90 MB, a few minutes). After that it only sends the files that
changed, usually under 1 MB. Your data (`data/`: stats, links, pairings, push keys) is never touched.

## Every day after that

- A change is merged into `main` → about 10 to 15 minutes later it's live (tests ~8 min, upload ~2 min).
- A change that only touches tests or notes → nothing is uploaded.
- If a test fails, nothing goes live. The site stays as it was.
- **Undo a bad update:** Actions → Deploy → Run workflow → put the commit from before it in **Commit** →
  Run. That version goes live again.
- **Something looks out of sync:** Run workflow → **Send everything**.

## Good to know

- **Make every change through GitHub from now on.** If you upload a zip by hand, the next GitHub deploy can
  overwrite those files with what is on GitHub. So push changes made on the PC to GitHub first.
- **Want to approve each deploy?** GitHub → Settings → **Environments → production → Required reviewers**
  → add yourself. Every deploy then waits for you to click **Approve**.
- To turn auto-deploy off, delete the `CPANEL_TOKEN` secret (or delete the token in cPanel).
- The record of which commit is live is kept in `tmp/omnibeam-deployed-commit.txt` in the app folder. The
  web server never shows that folder to visitors.
- FTP instead of a token also works (`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_APP_DIR`), but the token is
  faster and safer.
