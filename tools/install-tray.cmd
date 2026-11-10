@echo off
rem OmniBeam in the Windows tray: adds it to the Start menu and to Windows startup, then starts it.
rem Needs Node.js 22 or newer from https://nodejs.org. Keep this folder where it is (the shortcuts point here).
where node >nul 2>nul || (echo OmniBeam needs Node.js 22 or newer: https://nodejs.org & start "" https://nodejs.org & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = New-Object -ComObject WScript.Shell; foreach ($f in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'))) { $l = $s.CreateShortcut((Join-Path $f 'OmniBeam.lnk')); $l.TargetPath = 'powershell.exe'; $l.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0omnibeam-tray.ps1\"'; $l.IconLocation = '%~dp0omnibeam.ico'; $l.Description = 'OmniBeam tray'; $l.Save() }"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0omnibeam-tray.ps1"
echo.
echo OmniBeam is in the tray now, next to the clock. If you do not see it, click the small up-arrow there.
echo Click it to send files. Right-click it to pair your phone once, so it finds your phone on any network.
echo It also starts with Windows. Untick "Start with Windows" in its menu to stop that.
pause
