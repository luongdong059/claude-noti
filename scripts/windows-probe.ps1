<#
.SYNOPSIS
  Measures what actually works on this Windows machine before any Windows
  support is written for Claude Noti.

.DESCRIPTION
  Every question here is one that cannot be answered from documentation. The
  macOS version of this extension was built partly on documented behaviour that
  turned out to be false — the Notification hook that never fired, the sender
  override that silently swallowed notifications — and each wrong assumption
  cost real time. So nothing gets written for Windows until this script has run.

  It downloads snoretoast.exe (from the node-notifier package on the public npm
  registry), posts a few test notifications, and asks you to click one. It
  writes everything to a log file and prints where it is at the end.

  Nothing is installed permanently and nothing outside the temp folder is
  modified, except in step 4 which asks before touching the Start Menu.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File windows-probe.ps1
#>

$ErrorActionPreference = 'Continue'

$work = Join-Path $env:TEMP "claude-noti-probe"
$log = Join-Path $work "probe-log.txt"
New-Item -ItemType Directory -Force -Path $work | Out-Null
Remove-Item $log -ErrorAction SilentlyContinue

function Say($text) {
  Write-Host $text
  Add-Content -Path $log -Value $text
}
function Section($title) {
  Say ""
  Say "=== $title ==="
}
function Ask($question) {
  Write-Host ""
  Write-Host $question -ForegroundColor Yellow
  $answer = Read-Host "  tra loi"
  Add-Content -Path $log -Value "Q: $question"
  Add-Content -Path $log -Value "A: $answer"
  return $answer
}

Say "claude-noti windows probe"
Say "chay luc: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ---------------------------------------------------------------------------
Section "1. Moi truong"

$os = Get-CimInstance Win32_OperatingSystem
Say "  windows:     $($os.Caption) build $($os.BuildNumber)"
Say "  powershell:  $($PSVersionTable.PSVersion)"
Say "  kien truc:   $env:PROCESSOR_ARCHITECTURE"

# Which shell Claude Code will use for hooks depends on whether Git Bash is
# present, so this decides whether hook.sh or hook.ps1 is the primary script.
$gitBash = @(
  "$env:ProgramFiles\Git\bin\bash.exe",
  "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
  "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
Say "  git bash:    $(if ($gitBash) { $gitBash } else { 'KHONG CO -> Claude Code se dung PowerShell cho hook' })"

$codeExe = @(
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  "$env:ProgramFiles\Microsoft VS Code\Code.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
Say "  Code.exe:    $(if ($codeExe) { $codeExe } else { 'KHONG TIM THAY' })"

$claude = Get-Command claude -ErrorAction SilentlyContinue
Say "  claude:      $(if ($claude) { $claude.Source } else { 'KHONG TIM THAY tren PATH' })"

# Focus Assist silences toasts the same way macOS Focus does, and that cost an
# hour of misdiagnosis on the mac side.
$focus = Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings' -ErrorAction SilentlyContinue
Say "  toast bat toan cuc: $(if ($null -ne $focus.NOC_GLOBAL_SETTING_TOASTS_ENABLED) { $focus.NOC_GLOBAL_SETTING_TOASTS_ENABLED } else { '(khong doc duoc, mac dinh la bat)' })"

# ---------------------------------------------------------------------------
Section "2. Lay snoretoast.exe"

$exe = Get-ChildItem -Path $work -Recurse -Filter "snoretoast*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  $tgz = Join-Path $work "node-notifier.tgz"
  $url = "https://registry.npmjs.org/node-notifier/-/node-notifier-10.0.1.tgz"
  Say "  tai tu: $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing
    tar -xf $tgz -C $work
    $exe = Get-ChildItem -Path $work -Recurse -Filter "snoretoast*.exe" | Select-Object -First 1
  } catch {
    Say "  LOI khi tai: $_"
  }
}
if (-not $exe) {
  Say "  KHONG lay duoc snoretoast.exe — dung o day, gui log cho toi"
  Say ""
  Say "log: $log"
  exit 1
}
$snore = $exe.FullName
Say "  snoretoast:  $snore"
Say "  kich thuoc:  $([math]::Round($exe.Length/1KB)) KB"

# ---------------------------------------------------------------------------
Section "3. Toast KHONG kem -appID"

# Windows 10 Fall Creators Update onwards is documented as requiring a
# registered AppUserModelID. If a bare toast shows anyway, the extension can
# skip touching the Start Menu entirely.
Say "  dang ban..."
& $snore -t "Claude Noti probe 1" -m "KHONG dung appID" | Out-Null
Say "  ma thoat: $LASTEXITCODE"
$a3 = Ask "Ban co THAY thong bao 'Claude Noti probe 1' tren man hinh khong? (co/khong)"

# ---------------------------------------------------------------------------
Section "4. Toast kem AUMID cua VS Code"

# Borrowing an AUMID that Windows already knows would avoid creating a Start
# Menu shortcut. On macOS the equivalent trick failed outright, so this is
# measured rather than assumed.
$aumids = @()
if ($codeExe) {
  $shortcuts = Get-ChildItem -Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'Visual Studio Code' }
  foreach ($s in $shortcuts) { Say "  shortcut VS Code: $($s.FullName)" }
  $aumids = @("Microsoft.VisualStudioCode")
}
foreach ($id in $aumids) {
  Say "  thu appID: $id"
  & $snore -t "Claude Noti probe 2" -m "appID = $id" -appID $id | Out-Null
  Say "  ma thoat: $LASTEXITCODE"
}
$a4 = Ask "Ban co THAY thong bao 'Claude Noti probe 2' khong, va no mang icon cua app nao? (khong / ten app)"

# ---------------------------------------------------------------------------
Section "5. Bat su kien click (quan trong nhat)"

# This is the feature. If the exit code does not come back as 0 on click, the
# "click to jump back to the right window" behaviour cannot be built here.
Say "  se ban 1 thong bao va CHO ban bam vao no."
Say "  bam vao THAN thong bao, dung bam nut dong."
$proc = Start-Process -FilePath $snore -ArgumentList @('-t', 'Claude Noti probe 3', '-m', 'HAY BAM VAO TOI', '-w', '-d', 'long') -PassThru -Wait -NoNewWindow
Say "  ma thoat: $($proc.ExitCode)"
Say "  (0 = da bam vao than | 1 = an | 2 = bo qua | 3 = het han | 4 = bam nut)"
$a5 = Ask "Ban da lam gi voi thong bao do? (bam vao than / bo qua / khong thay / no tu bien mat)"

# ---------------------------------------------------------------------------
Section "6. Toast o lai duoc bao lau"

Say "  ban thong bao voi -d long, dem thoi gian no bien mat khoi man hinh."
& $snore -t "Claude Noti probe 4" -m "Dem xem toi o lai bao lau" -d long | Out-Null
$a6 = Ask "Thong bao o lai tren man hinh khoang bao nhieu giay truoc khi bien mat?"

# ---------------------------------------------------------------------------
Section "7. Focus dung cua so VS Code"

# The macOS version passes the workspace path to `open -a`, which makes VS Code
# raise the window that already has that folder open. Whether Code.exe behaves
# the same way decides whether the click can land on the right window.
if ($codeExe) {
  Say "  Code.exe: $codeExe"
  $folder = Ask "Nhap duong dan mot folder DANG mo trong mot cua so VS Code khac (vd C:\Users\ban\du-an)"
  if ($folder -and (Test-Path $folder)) {
    Say "  chay: Code.exe `"$folder`""
    Start-Process -FilePath $codeExe -ArgumentList @($folder)
    Start-Sleep -Seconds 4
    $a7 = Ask "No FOCUS cua so dang mo folder do, hay MO CUA SO MOI? (focus / cua so moi / khong co gi)"
  } else {
    Say "  bo qua, duong dan khong hop le"
  }
} else {
  Say "  bo qua, khong tim thay Code.exe"
}

# ---------------------------------------------------------------------------
Section "8. Hook PermissionRequest tren Windows"

$hookDir = Join-Path $env:USERPROFILE ".claude-noti"
$hookLog = Join-Path $hookDir "windows-probe-hook.log"
$hookPs1 = Join-Path $hookDir "probe-hook.ps1"
New-Item -ItemType Directory -Force -Path $hookDir | Out-Null

@'
$payload = [Console]::In.ReadToEnd()
Add-Content -Path "$env:USERPROFILE\.claude-noti\windows-probe-hook.log" -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $payload)
exit 0
'@ | Set-Content -Path $hookPs1 -Encoding UTF8

Say "  da tao hook ghi log: $hookPs1"
Say ""
Say "  Them doan sau vao %USERPROFILE%\.claude\settings.json (muc hooks),"
Say "  roi mo phien claude MOI va tao mot lan xin quyen:"
Say ""
$hookJson = @"
    "PermissionRequest": [
      { "hooks": [ { "type": "command", "shell": "powershell",
          "command": "powershell -ExecutionPolicy Bypass -File $($hookPs1.Replace('\','\\'))" } ] }
    ]
"@
Say $hookJson
$a8 = Ask "Da lam xong buoc tren chua? Go 'xong' khi da tao it nhat 1 lan xin quyen (hoac 'bo qua')"

if (Test-Path $hookLog) {
  Say "  --- su kien bat duoc ---"
  Get-Content $hookLog | ForEach-Object {
    try {
      $j = ($_ -split '  ', 2)[1] | ConvertFrom-Json
      Say "  $($_.Substring(0,8))  $($j.hook_event_name)  tool=$($j.tool_name)  cwd=$($j.cwd)"
    } catch { Say "  $_" }
  }
  Say "  --- payload day du cua su kien dau tien ---"
  Get-Content $hookLog -TotalCount 1 | Say
} else {
  Say "  (khong co su kien nao duoc ghi)"
}

# ---------------------------------------------------------------------------
Section "Tom tat"
Say "  3. toast khong appID:      $a3"
Say "  4. toast voi AUMID:        $a4"
Say "  5. bat click:              ma thoat $($proc.ExitCode), ban lam: $a5"
Say "  6. o lai tren man hinh:    $a6"
Say "  7. focus cua so:           $(if ($a7) { $a7 } else { 'bo qua' })"
Say "  8. hook PermissionRequest: $a8"

Say ""
Say "Xong. Gui file nay cho toi:"
Write-Host $log -ForegroundColor Green
Say ""
Say "Don dep: xoa thu muc $work va $hookPs1, va go doan hook vua them khoi settings.json"
