@echo off
rem Double-click AFTER uploading to cPanel and clicking Restart: checks the live omnibeam.site end to end.
rem Browsers on this PC act as devices and use the real site:
rem   1. Quick check (tests\live.check.js): the newest version is live, 5 languages, sending files both ways
rem      and a message, sending through the server, the menu, the pairing QR code and a share link.
rem   2. Full check (tests\live-full.check.js): pairing by code and QR link, sending direct and through the relay,
rem      several files as a ZIP, decline, cancel, send to everyone, share links with a PIN and a download limit,
rem      team and public rooms, history (Received, Gallery, Sent), name and picture, themes, all 9 languages,
rem      every page in the sitemap, offline mode, and the store and social links.
rem The second runs even if the first fails. A summary is shown at the end.
cd /d "%~dp0"
rem Chromium won't start from the default ms-playwright folder on this PC (SideBySide error), so use the copy in pw-browsers if it's there
if exist "%USERPROFILE%\pw-browsers" set "PLAYWRIGHT_BROWSERS_PATH=%USERPROFILE%\pw-browsers"
where node >nul 2>nul || (echo OmniBeam needs Node.js from https://nodejs.org & pause & exit /b 1)
if not exist node_modules\@playwright\test (
  call npm install || (pause & exit /b 1)
  call npx playwright install chromium || (pause & exit /b 1)
)
rem The quick check empties tests\.results-live, so keep the written report safe while it runs
if exist tests\.results-live\full-report.md copy /y tests\.results-live\full-report.md "%TEMP%\omnibeam-full-report.md" >nul

echo.
echo === 1 of 2: quick check ===
call npx playwright test -c tests/live.config.js
if errorlevel 1 (set "QUICK=FAILED") else (set "QUICK=PASSED")

echo.
echo === 2 of 2: full feature check ===
call npx playwright test -c tests/live-full.config.js
if errorlevel 1 (set "FULL=FAILED") else (set "FULL=PASSED")

if exist "%TEMP%\omnibeam-full-report.md" if not exist tests\.results-live\full-report.md copy /y "%TEMP%\omnibeam-full-report.md" tests\.results-live\full-report.md >nul

echo.
echo ================ Summary ================
echo   Quick check (live.check.js):      %QUICK%
echo   Full check (live-full.check.js):  %FULL%
echo   Report:          tests\.results-live\full-report.md
echo   Full results:    tests\.results-live-full\results.json
echo   Failure details: tests\.results-live and tests\.results-live-full (screenshots, error-context.md)
echo =========================================
pause
