@echo off
rem Double-click to run the automatic tests (two browsers send files to each other on this PC).
rem The first time it downloads the test tool and its browser (about 150 MB).
cd /d "%~dp0"
rem Chromium won't start from the default ms-playwright folder on this PC (SideBySide error), so use the copy in pw-browsers if it's there
if exist "%USERPROFILE%\pw-browsers" set "PLAYWRIGHT_BROWSERS_PATH=%USERPROFILE%\pw-browsers"
where node >nul 2>nul || (echo OmniBeam needs Node.js from https://nodejs.org & pause & exit /b 1)
if not exist node_modules\@playwright\test (
  call npm install || (pause & exit /b 1)
  call npx playwright install chromium || (pause & exit /b 1)
)
call npm test
pause
