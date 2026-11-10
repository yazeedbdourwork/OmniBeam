# OmniBeam in the Windows tray: send files to your phone without opening the browser.
#
# Click the OmniBeam icon next to the clock to pick files, or right-click it for more: send the text on the
# clipboard, sync the clipboard to your phones, pair with a phone, start with Windows, add OmniBeam to the
# right-click "Send to" menu.
# Files go through omnibeam-send.js (in this folder), so this needs Node.js 22 or newer from https://nodejs.org.
# Start it with install-tray.cmd (also adds it to the Start menu), or:
#   powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File omnibeam-tray.ps1
# Settings: OMNIBEAM_SERVER (default https://omnibeam.site).

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sender = Join-Path $here 'omnibeam-send.js'
$server = if ($env:OMNIBEAM_SERVER) { $env:OMNIBEAM_SERVER } else { 'https://omnibeam.site' }
$pcName = $env:COMPUTERNAME
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'OmniBeam.lnk'
$sendToFile = Join-Path ([Environment]::GetFolderPath('SendTo')) 'OmniBeam.lnk'

# Only one tray icon at a time
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\OmniBeamTray', [ref]$created)
if (-not $created) { exit }

$node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
  [System.Windows.Forms.MessageBox]::Show("OmniBeam needs Node.js (version 22 or newer).`n`nInstall it from nodejs.org, then start OmniBeam again.", 'OmniBeam', 'OK', 'Information') | Out-Null
  Start-Process 'https://nodejs.org'
  exit
}

function Quote([string]$s) { '"' + ($s -replace '"', '\"') + '"' }

# Run omnibeam-send.js and return what it printed (for --list and --paired)
function Run-Sender([string[]]$arguments, [int]$timeoutMs = 20000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = ((@($sender, '--server', $server) + $arguments) | ForEach-Object { Quote $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutMs)) { try { $p.Kill() } catch {} }
  return @{ Code = $p.ExitCode; Out = $out.Result; Err = $err.Result }
}

# Run omnibeam-send.js in a small console window that shows the progress (and stays open on errors)
function Start-Sender([string[]]$arguments) {
  $all = @($sender, '--server', $server, '--name', $pcName, '--wait') + $arguments
  Start-Process -FilePath $node -ArgumentList (($all | ForEach-Object { Quote $_ }) -join ' ')
}

function Show-Tip([string]$text) {
  $tray.BalloonTipTitle = 'OmniBeam'
  $tray.BalloonTipText = $text
  $tray.ShowBalloonTip(4000)
}

# Ask which device to send to. Returns its name, or $null.
function Pick-Device {
  Show-Tip 'Looking for your devices...'
  $r = Run-Sender @('--list', '--name', $pcName)
  $devices = @()
  # ForEach-Object unrolls the list (Windows PowerShell 5.1 passes a JSON array on as one object)
  try { $devices = @(ConvertFrom-Json $r.Out | ForEach-Object { $_ } | Where-Object { $_ -and $_.name }) } catch {}
  if (-not $devices.Count) {
    [System.Windows.Forms.MessageBox]::Show("No devices found.`n`nOpen omnibeam.site on your phone. Devices on the same Wi-Fi show up automatically; for any network, pair once (right-click the tray icon > Pair with a phone).", 'OmniBeam', 'OK', 'Information') | Out-Null
    return $null
  }
  if ($devices.Count -eq 1) { return $devices[0].name }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Send to'
  $form.StartPosition = 'CenterScreen'
  $form.Size = New-Object System.Drawing.Size(340, 300)
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $list = New-Object System.Windows.Forms.ListBox
  $list.Location = New-Object System.Drawing.Point(12, 12)
  $list.Size = New-Object System.Drawing.Size(300, 190)
  $list.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  foreach ($d in $devices) { [void]$list.Items.Add("$($d.name)  ($($d.device))") }
  $list.SelectedIndex = 0
  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Send'
  $ok.Location = New-Object System.Drawing.Point(156, 214)
  $ok.DialogResult = 'OK'
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'
  $cancel.Location = New-Object System.Drawing.Point(237, 214)
  $cancel.DialogResult = 'Cancel'
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  $list.Add_DoubleClick({ $form.DialogResult = 'OK'; $form.Close() })
  $form.Controls.AddRange(@($list, $ok, $cancel))
  if ($form.ShowDialog() -ne 'OK') { return $null }
  return $devices[$list.SelectedIndex].name
}

function Send-Files {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Send with OmniBeam'
  $dlg.Multiselect = $true
  if ($dlg.ShowDialog() -ne 'OK') { return }
  $to = Pick-Device
  if (-not $to) { return }
  Start-Sender (@('--to', $to) + $dlg.FileNames)
}

function Send-Clipboard {
  $text = Get-Clipboard -Raw -ErrorAction SilentlyContinue
  if (-not $text) { Show-Tip 'The clipboard has no text.'; return }
  $to = Pick-Device
  if (-not $to) { return }
  Start-Sender @('--to', $to, '--text', $text)
}

function Pair-Phone {
  Add-Type -AssemblyName Microsoft.VisualBasic
  $code = [Microsoft.VisualBasic.Interaction]::InputBox("On your phone, open omnibeam.site, tap the link button (Pair) and then 'Create a pairing code'.`n`nType the 6-digit code here:", 'Pair with a phone', '')
  $code = ($code -replace '\D', '')
  if ($code.Length -ne 6) { return }
  Start-Sender @('--pair', $code)
}

function Show-Paired {
  $r = Run-Sender @('--paired')
  $text = if ($r.Out) { $r.Out.Trim() } else { 'No remembered devices.' }
  $answer = [System.Windows.Forms.MessageBox]::Show("$text`n`nRemembered devices find this computer on any network.`nForget all of them?", 'OmniBeam: paired devices', 'YesNo', 'Information')
  if ($answer -eq 'Yes') {
    $file = Join-Path $env:APPDATA 'OmniBeam\paired.json'
    if (Test-Path $file) { Remove-Item $file }
    Show-Tip 'Forgot all paired devices.'
  }
}

function Set-Startup([bool]$on) {
  if ($on) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($startupLink)
    $link.TargetPath = 'powershell.exe'
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $(Quote (Join-Path $here 'omnibeam-tray.ps1'))"
    $link.IconLocation = (Join-Path $here 'omnibeam.ico')
    $link.Description = 'OmniBeam tray'
    $link.Save()
  } elseif (Test-Path $startupLink) {
    Remove-Item $startupLink
  }
}

function Add-SendTo {
  $r = Run-Sender @('--install-sendto')
  if ($r.Code -eq 0) { Show-Tip 'Added. Right-click any files > Send to > OmniBeam.' }
  else { [System.Windows.Forms.MessageBox]::Show("Could not add it: $($r.Err)", 'OmniBeam') | Out-Null }
}

# ---------- Clipboard sync ----------
# When on, text copied on this PC goes to the paired phones that have OmniBeam open; a phone with Clipboard
# sync on (OmniBeam > Settings) puts it on its clipboard, others show it as a message. Text that password
# managers mark as private (not for clipboard history) is never sent.
$clipFlag = Join-Path $env:APPDATA 'OmniBeam\clip-sync'
$script:lastClip = $null
function Send-ClipSync([string]$text) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = ((@($sender, '--server', $server, '--name', $pcName, '--clip', '-')) | ForEach-Object { Quote $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  # As UTF-8 bytes: Windows PowerShell would otherwise use the console's code page
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $p.StandardInput.Close()
}
$clipTimer = New-Object System.Windows.Forms.Timer
$clipTimer.Interval = 1500
$clipTimer.Add_Tick({
  $text = $null
  try {
    if ([System.Windows.Forms.Clipboard]::ContainsData('ExcludeClipboardContentFromMonitorProcessing')) { return }
    $text = [System.Windows.Forms.Clipboard]::GetText()
  } catch { return }
  if (-not $text -or $text -eq $script:lastClip) { return }
  # What was on the clipboard when sync started isn't sent, only what is copied after
  $first = ($null -eq $script:lastClip)
  $script:lastClip = $text
  if (-not $first -and $text.Length -le 100000) { Send-ClipSync $text }
})
function Set-ClipSync([bool]$on) {
  if ($on) {
    New-Item -ItemType File -Force -Path $clipFlag | Out-Null
    $script:lastClip = $null
    $clipTimer.Start()
    Show-Tip 'Clipboard sync is on. Text you copy goes to your paired phones that have OmniBeam open. Turn on Clipboard sync in OmniBeam Settings on the phone too.'
  } else {
    if (Test-Path $clipFlag) { Remove-Item $clipFlag }
    $clipTimer.Stop()
  }
}

# ---------- The tray icon and its menu ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$iconFile = Join-Path $here 'omnibeam.ico'
$tray.Icon = if (Test-Path $iconFile) { New-Object System.Drawing.Icon($iconFile) } else { [System.Drawing.SystemIcons]::Application }
$tray.Text = 'OmniBeam: click to send files'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item([string]$text, [scriptblock]$action) {
  $item = $menu.Items.Add($text)
  $item.Add_Click($action)
  return $item
}
$sendItem = Add-Item 'Send files...' { Send-Files }
$sendItem.Font = New-Object System.Drawing.Font($sendItem.Font, [System.Drawing.FontStyle]::Bold)
[void](Add-Item 'Send clipboard text...' { Send-Clipboard })
$clipItem = Add-Item 'Sync clipboard to paired phones' { Set-ClipSync (-not (Test-Path $clipFlag)); $clipItem.Checked = (Test-Path $clipFlag) }
$clipItem.Checked = (Test-Path $clipFlag)
if (Test-Path $clipFlag) { $clipTimer.Start() }
[void](Add-Item 'Open omnibeam.site' { Start-Process $server })
[void]$menu.Items.Add('-')
[void](Add-Item 'Pair with a phone...' { Pair-Phone })
[void](Add-Item 'Paired devices...' { Show-Paired })
$startItem = Add-Item 'Start with Windows' { Set-Startup (-not (Test-Path $startupLink)); $startItem.Checked = (Test-Path $startupLink) }
$startItem.Checked = (Test-Path $startupLink)
$sendToItem = Add-Item 'Add to right-click "Send to"' { Add-SendTo }
$menu.Add_Opening({ $sendToItem.Enabled = -not (Test-Path $sendToFile) })
[void]$menu.Items.Add('-')
[void](Add-Item 'Exit' { $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.Add_MouseClick({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send-Files } })
$tray.Visible = $true
# Say hello the first time only
$seen = Join-Path $env:APPDATA 'OmniBeam\tray-started'
if (-not (Test-Path $seen)) {
  New-Item -ItemType File -Force -Path $seen | Out-Null
  Show-Tip 'OmniBeam is here. Click this icon to send files to your phone.'
}

[System.Windows.Forms.Application]::Run()
$tray.Dispose()
$mutex.ReleaseMutex()
