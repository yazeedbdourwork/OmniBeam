@echo off
rem Adds "OmniBeam" to the right-click "Send to" menu. Needs Node.js 22+ from https://nodejs.org
node "%~dp0omnibeam-send.js" --install-sendto
pause
