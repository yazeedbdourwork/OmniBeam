@echo off
rem Double-click to check the files and build the zip to upload to cPanel (see DEPLOY.md, "Updating the site").
cd /d "%~dp0"
where node >nul 2>nul || (echo OmniBeam needs Node.js from https://nodejs.org & pause & exit /b 1)
node tools\deploy.js
pause
