# in-sandbox.ps1 -- the ClaudeDevStudio installer test, run INSIDE Windows Sandbox as a new
# user (started by the .wsb that run-sandbox-test.ps1 writes; never run it on a real PC).
#
# Folders mapped by the .wsb:
#   C:\cds\installer  ClaudeDevStudio-Setup.exe (read-only)
#   C:\cds\kit        tools\sandbox-test (read-only)
#   C:\cds\mcptest    mcp-server\test (read-only)
#   C:\cds\results    tools\sandbox-test\results\<run> (writable)
#
# Scenarios, in order: A fresh install, B upgrade, C uninstall, D Documents redirected.
# Writes results.json (each check: scenario, name, PASS/FAIL, evidence) after every check
# and sandbox.log, copies the installer's logs, then shuts the sandbox down.

$ErrorActionPreference = 'Continue'
$Kit      = 'C:\cds\kit'
$InstallerDir = 'C:\cds\installer'
$McpTest  = 'C:\cds\mcptest'
$Res      = 'C:\cds\results'
$Work     = 'C:\cds-work'
$Inst     = Join-Path $env:LOCALAPPDATA 'ClaudeDevStudio'
$Node     = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$CfgDir   = Join-Path $env:APPDATA 'Claude'
$Cfg      = Join-Path $CfgDir 'claude_desktop_config.json'
$Seed     = Join-Path $Work 'seed.json'
$Profile0 = $env:USERPROFILE
$PlainDocs = Join-Path $Profile0 'Documents'
$Redirected = Join-Path $Profile0 'RedirectedDocs'
$UserShellFolders = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$ShellFolders     = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders'

New-Item -ItemType Directory -Force -Path $Work | Out-Null
$LogFile = Join-Path $Res 'sandbox.log'
$Checks = New-Object System.Collections.Generic.List[object]
$Info = [ordered]@{}
$Started = Get-Date -Format 's'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Log([string]$Message) {
    $line = '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
    Write-Host $line
    try { [System.IO.File]::AppendAllText($LogFile, $line + "`r`n", $Utf8) } catch { }
}

function Save-Results([bool]$Finished) {
    $passed = @($Checks | Where-Object { $_.result -eq 'PASS' }).Count
    $obj = [ordered]@{
        finished = $Finished; started = $Started; updated = (Get-Date -Format 's')
        passed = $passed; failed = $Checks.Count - $passed; info = $Info; checks = $Checks
    }
    $tmp = Join-Path $Res 'results.json.tmp'
    [System.IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 6), $Utf8)
    Move-Item -LiteralPath $tmp -Destination (Join-Path $Res 'results.json') -Force
}

function Check([string]$Scenario, [string]$Name, [bool]$Ok, $Evidence) {
    $ev = [string]$Evidence
    if ($ev.Length -gt 1500) { $ev = $ev.Substring(0, 1500) + ' ...' }
    $r = if ($Ok) { 'PASS' } else { 'FAIL' }
    $Checks.Add([pscustomobject]@{ scenario = $Scenario; name = $Name; result = $r; evidence = $ev })
    Log "$r  [$Scenario] $Name -- $ev"
    Save-Results $false
}

# Runs a program with a time limit; returns @{ code; out }. Code -999 = timed out (killed).
function Invoke-Tool([string]$Exe, [string]$Arguments, [int]$TimeoutSec = 600, [hashtable]$Env = $null) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    if ($Env) { foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = $Env[$k] } }
    try { $p = [System.Diagnostics.Process]::Start($psi) } catch { return @{ code = -998; out = "could not start $Exe : $($_.Exception.Message)" } }
    $so = $p.StandardOutput.ReadToEndAsync()
    $se = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return @{ code = -999; out = "TIMEOUT after $TimeoutSec s" }
    }
    $p.WaitForExit()
    [void]$so.Wait(10000); [void]$se.Wait(10000)
    $text = ''
    if ($so.IsCompleted) { $text += $so.Result }
    if ($se.IsCompleted) { $text += $se.Result }
    return @{ code = $p.ExitCode; out = $text.Trim() }
}

function Get-Docs {
    $r = Invoke-Tool 'powershell.exe' "-NoProfile -Command [Environment]::GetFolderPath('MyDocuments')" 60
    return $r.out.Trim()
}

function Get-UserPathRaw {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    $v = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = if ($k.GetValueNames() -contains 'Path') { [string]$k.GetValueKind('Path') } else { 'none' }
    $k.Close()
    return @{ value = $v; kind = $kind }
}

# Paths (and file hashes) under a folder, sorted, as one string.
function Get-TreeSnapshot([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return '(missing)' }
    $items = Get-ChildItem -LiteralPath $Dir -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName
    $lines = foreach ($i in $items) {
        $rel = $i.FullName.Substring($Dir.Length)
        if ($i.PSIsContainer) { "D $rel" } else { "F $rel $((Get-FileHash -LiteralPath $i.FullName -Algorithm SHA256).Hash)" }
    }
    return ($lines -join "`n")
}

function Node-Json([string]$Arguments) {
    $r = Invoke-Tool $Node $Arguments 120
    try { return ($r.out | ConvertFrom-Json) } catch { return [pscustomobject]@{ ok = $false; problems = @("not JSON (exit $($r.code)): $($r.out)") } }
}

function Check-Config([string]$Scenario, [string]$Expect, [string]$Label) {
    $j = Node-Json "`"$Kit\check-config.js`" config `"$Cfg`" `"$Seed`" $Expect"
    $ev = if ($j.ok) { "servers: $($j.servers -join ', '); keep-me $($j.keepMe | ConvertTo-Json -Compress); preferences $($j.preferences | ConvertTo-Json -Compress); someOtherSetting $($j.someOtherSetting); BOM $($j.bom)" } else { "problems: $($j.problems -join ' | ')" }
    if ($Expect -eq 'expect-cds' -and $j.ok) { $ev += "; node: $($j.cds.claudedevstudio.command); index.js: $($j.cds.claudedevstudio.arg0); workbench.js: $($j.cds.'cds-workbench'.arg0)" }
    Check $Scenario $Label ([bool]$j.ok) $ev
}

function Run-Installer([string]$Scenario) {
    $setup = Join-Path $Work 'ClaudeDevStudio-Setup.exe'
    $t0 = Get-Date
    $logPath = Join-Path $Inst 'install.log'
    $seen = 0
    if (Test-Path $logPath) { $seen = @(Get-Content -LiteralPath $logPath).Count }
    $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru
    $null = $p.Handle   # keeps the exit code readable after the process ends
    $code = $null
    while ($true) {
        $done = $p.WaitForExit(10000)
        # Timestamp the installer's own step lines as they appear (shows which step is slow).
        if (Test-Path $logPath) {
            $lines = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue)
            for ($i = $seen; $i -lt $lines.Count; $i++) { Log "    install.log: $($lines[$i])" }
            $seen = $lines.Count
        }
        if ($done) { $code = $p.ExitCode; break }
        if (((Get-Date) - $t0).TotalSeconds -gt 1800) { try { $p.Kill() } catch { }; $code = -999; break }
    }
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    Check $Scenario 'installer /S exits 0' ($code -eq 0) "exit $code after $secs s"
    if (Test-Path (Join-Path $Inst 'install.log')) { Copy-Item (Join-Path $Inst 'install.log') (Join-Path $Res "$Scenario-install.log") -Force }
}

function Check-Program([string]$Scenario) {
    $need = @('CLI\claudedev.exe', 'TrayApp\ClaudeDevStudio.TrayApp.exe', 'Dashboard\ClaudeDevStudio.Dashboard.exe',
              'mcp-server\index.js', 'mcp-server\workbench.js', 'mcp-server\package.json', 'mcp-server\qwen_config.template.json',
              'mcp-server\node_modules\@modelcontextprotocol\sdk\package.json', 'review-server\server.js',
              'review-server\node_modules\express\package.json', 'VSExtension\CdsVsBridge.vsix',
              'cds-config.js', 'cds-vsix.ps1', 'cds-path.ps1', 'Uninstall.exe')
    $missing = @($need | Where-Object { -not (Test-Path (Join-Path $Inst $_)) })
    Check $Scenario 'program files are in place' ($missing.Count -eq 0) $(if ($missing.Count) { "missing: $($missing -join ', ')" } else { "$($need.Count) files present under $Inst" })
    $v = Invoke-Tool (Join-Path $Inst 'CLI\claudedev.exe') 'version' 60
    Check $Scenario 'claudedev version prints 1.3.0' ($v.code -eq 0 -and $v.out -match 'v1\.3\.0') "exit $($v.code): $(($v.out -split "`n")[0])"
    $nv = Invoke-Tool $Node '--version' 60
    Check $Scenario 'Node.js is installed' ($nv.code -eq 0) "$Node $($nv.out)"
}

function Copy-McpTests {
    $dest = Join-Path $Inst 'mcp-server\test'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item (Join-Path $McpTest '*') $dest -Recurse -Force
    Copy-Item (Join-Path $Kit 'mcp-probe.mjs') $dest -Force
    return $dest
}

function Run-Smoke([string]$Scenario) {
    $t = Copy-McpTests
    $r = Invoke-Tool $Node "`"$t\smoke.mjs`" `"$Inst\mcp-server\index.js`" --cli `"$Inst\CLI\claudedev.exe`"" 600
    [System.IO.File]::WriteAllText((Join-Path $Res "$Scenario-smoke.txt"), $r.out, $Utf8)
    $summary = ([regex]::Match($r.out, '\d+ passed, \d+ failed')).Value
    $fails = (($r.out -split "`n") | Where-Object { $_ -like 'FAIL*' }) -join ' | '
    Check $Scenario 'memory server smoke test (installed index.js + installed CLI) passes' ($r.code -eq 0 -and $summary -match ', 0 failed') "exit $($r.code); $summary $fails"
}

function Probe-Memory([string]$Scenario, [string]$ProjectName, [string]$ExpectDocs) {
    $proj = Join-Path 'C:\cds-projects' $ProjectName
    New-Item -ItemType Directory -Force -Path $proj | Out-Null
    $t = Copy-McpTests
    $text = "sandbox scenario $Scenario activity"
    $j = Node-Json "`"$t\mcp-probe.mjs`" memory `"$Inst\mcp-server\index.js`" `"$proj`" `"$text`""
    $expectDir = Join-Path $ExpectDocs "ClaudeDevStudio\Projects\$ProjectName"
    $act = @(Get-ChildItem -LiteralPath (Join-Path $expectDir 'Activity') -Filter '*.jsonl' -ErrorAction SilentlyContinue)
    $written = $false
    foreach ($f in $act) { if ((Get-Content -LiteralPath $f.FullName -Raw) -match [regex]::Escape($text)) { $written = $true } }
    $ok = $j.ok -and -not $j.load.isError -and -not $j.record.isError -and $j.shown -and ($j.memoryFolder -eq $expectDir) -and $written
    $err = if ($j.error) { "; error $($j.error)" } else { '' }
    Check $Scenario "memory lands in [Documents]\ClaudeDevStudio\Projects\$ProjectName" $ok "server says: $($j.memoryFolder); expected: $expectDir; activity file written: $written; shown on load: $($j.shown)$err"
}

function Check-Workbench([string]$Scenario) {
    $t = Copy-McpTests
    $j = Node-Json "`"$t\mcp-probe.mjs`" tools `"$Inst\mcp-server\workbench.js`""
    Check $Scenario 'workbench server lists 13 tools' ($j.ok -and $j.count -eq 13) "count $($j.count): $($j.names -join ', ') $($j.error)"
}

function Check-ReviewPanel([string]$Scenario) {
    $t = Copy-McpTests
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Node
    $psi.Arguments = "`"$Inst\review-server\server.js`""
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['CDS_REVIEW_PORT'] = '63099'
    $panel = [System.Diagnostics.Process]::Start($psi)
    $up = $false
    for ($i = 0; $i -lt 40 -and -not $up; $i++) {
        Start-Sleep -Milliseconds 500
        try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:63099/status' -UseBasicParsing -TimeoutSec 2; $up = $true } catch { }
    }
    $r = Invoke-Tool $Node "`"$t\caller-check.mjs`" http://127.0.0.1:63099 --panel" 120
    try { $panel.Kill() } catch { }
    [System.IO.File]::WriteAllText((Join-Path $Res "$Scenario-caller-check.txt"), $r.out, $Utf8)
    $summary = ([regex]::Match($r.out, '\d+ passed, \d+ failed')).Value
    Check $Scenario 'Review Panel from the installed files: caller-check.mjs passes' ($up -and $r.code -eq 0) "panel up: $up; exit $($r.code); $summary"
}

function Stop-CdsProcesses {
    foreach ($n in 'node', 'ClaudeDevStudio.TrayApp', 'claudedev', 'ClaudeDevStudio.Dashboard') {
        Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch { } }
    }
    Start-Sleep -Seconds 2
}

function Check-Path([string]$Scenario, [string]$Expected, [string]$Label) {
    $p = Get-UserPathRaw
    Check $Scenario $Label (($p.value -eq $Expected) -and ($p.kind -eq 'ExpandString')) "kind $($p.kind); length $($p.value.Length) (expected $($Expected.Length)); ends with: ...$($p.value.Substring([Math]::Max(0, $p.value.Length - 70)))"
}

try {
    # ---------------------------------------------------------------- setup
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Info.user = $id.Name
    $Info.elevated = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $Info.os = (Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [Environment]::OSVersion.Version.ToString()
    $Info.documents = Get-Docs
    $Info.network = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }).Count
    $Info.nodeBefore = Test-Path $Node
    $Info.dotnetDesktopBefore = @(Get-ChildItem "$env:ProgramFiles\dotnet\shared\Microsoft.WindowsDesktop.App" -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', '
    $Info.visualStudio = Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $Info.installerSha256 = (Get-FileHash (Join-Path $InstallerDir 'ClaudeDevStudio-Setup.exe') -Algorithm SHA256).Hash
    Log "Info: $($Info | ConvertTo-Json -Compress)"
    Save-Results $false
    Copy-Item (Join-Path $InstallerDir 'ClaudeDevStudio-Setup.exe') $Work -Force

    # Seed Claude Desktop's config as a user who already has another server and settings.
    New-Item -ItemType Directory -Force -Path $CfgDir | Out-Null
    $seedText = "{`r`n  `"mcpServers`": {`r`n    `"keep-me`": { `"command`": `"cmd`", `"args`": [`"/c`", `"echo`"] }`r`n  },`r`n  `"preferences`": { `"sidebarMode`": `"chat`" },`r`n  `"someOtherSetting`": 42`r`n}`r`n"
    [System.IO.File]::WriteAllText($Seed, $seedText, $Utf8)
    [System.IO.File]::WriteAllText($Cfg, $seedText, $Utf8)
    $seedBytes = [System.IO.File]::ReadAllBytes($Cfg)

    # Seed a long user PATH (over NSIS's 1024-character string limit), expandable entries included.
    $seedPath = '%USERPROFILE%\bin;' + ((1..45 | ForEach-Object { "C:\Tools\Some Long Folder Name $_\bin" }) -join ';')
    $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    $envKey.SetValue('Path', $seedPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    $envKey.Close()
    $cliDir = Join-Path $Inst 'CLI'
    Log "Seeded config ($($seedBytes.Length) bytes) and user PATH ($($seedPath.Length) chars)."

    # ---------------------------------------------------------------- A. fresh install
    $S = 'A'
    Log '=== A. Fresh install ==='
    Run-Installer $S
    Check-Program $S
    Check-Config $S 'expect-cds' 'config: both CDS entries (full node.exe path, files exist); keep-me, preferences, someOtherSetting unchanged; no BOM'
    $bak = @(Get-ChildItem $CfgDir -Filter 'claude_desktop_config.json.bak-cds-*')
    $bakSame = $bak.Count -ge 1 -and ([System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($bak[0].FullName)) -eq [System.Convert]::ToBase64String($seedBytes))
    Check $S 'config backup exists and equals the file before install' $bakSame "$($bak.Count) backup(s): $($bak.Name -join ', ')"
    $k = Node-Json "`"$Kit\check-config.js`" keys `"$Inst\mcp-server\qwen_config.json`""
    Check $S 'qwen_config.json exists with all keys empty' ([bool]$k.ok) "providers: $($k.providers -join ', '); empty: $($k.keysEmpty -join ', ') $($k.problems -join ' | ')"
    # Node.js's MSI (installed just before) adds its own npm folder to the user PATH.
    $npmDir = Join-Path $env:APPDATA 'npm'
    $pathBeforeCds = $seedPath + ';' + $npmDir
    Check-Path $S ($pathBeforeCds + ';' + $cliDir) 'user PATH: the long PATH kept (plus Node.js''s npm folder), CLI folder added once, still REG_EXPAND_SZ'
    $runKey = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).ClaudeDevStudio
    Check $S 'auto-start entry written on a first install' ([bool]$runKey) "$runKey"
    Run-Smoke $S
    Check-Workbench $S
    Check-ReviewPanel $S
    $docsA = Get-Docs
    Probe-Memory $S 'SandboxProj' $docsA
    $cc = Invoke-Tool (Join-Path $Inst 'CLI\claudedev.exe') 'configure-claude' 120
    Check $S 'claudedev configure-claude (tray app "Link Claude Desktop") exits 0' ($cc.code -eq 0) "exit $($cc.code): $(($cc.out -split "`n") -join ' / ')"
    Check-Config $S 'expect-cds' 'config after configure-claude: still everything kept, each CDS entry once'
    Stop-CdsProcesses

    # ---------------------------------------------------------------- B. upgrade
    $S = 'B'
    Log '=== B. Upgrade ==='
    $set = Node-Json "`"$Kit\check-config.js`" setkey `"$Inst\mcp-server\qwen_config.json`" groq sandbox-test-key"
    Check $S 'test key put into qwen_config.json (groq)' ([bool]$set.ok) "$($set.problems -join ' | ')"
    $memDir = Join-Path $docsA 'ClaudeDevStudio\Projects\SandboxProj'
    $memBefore = Get-TreeSnapshot $memDir
    Run-Installer $S
    $k = Node-Json "`"$Kit\check-config.js`" keys `"$Inst\mcp-server\qwen_config.json`" groq sandbox-test-key"
    Check $S 'the API key is still there after the upgrade (others still empty)' ([bool]$k.ok) "empty: $($k.keysEmpty -join ', ') $($k.problems -join ' | ')"
    Check-Config $S 'expect-cds' 'config: keep-me, preferences, someOtherSetting unchanged; each CDS entry once'
    $memAfter = Get-TreeSnapshot $memDir
    Check $S 'memory from A untouched' (($memBefore -eq $memAfter) -and $memBefore -ne '(missing)') "$(@($memBefore -split "`n").Count) items in $memDir, same before and after"
    Check-Path $S ($pathBeforeCds + ';' + $cliDir) 'user PATH: CLI folder still there once, rest unchanged'
    $v = Invoke-Tool (Join-Path $Inst 'CLI\claudedev.exe') 'version' 60
    Check $S 'claudedev version still 1.3.0' ($v.code -eq 0 -and $v.out -match 'v1\.3\.0') (($v.out -split "`n")[0])
    Stop-CdsProcesses

    # ---------------------------------------------------------------- C. uninstall
    $S = 'C'
    Log '=== C. Uninstall ==='
    $bakBefore = @(Get-ChildItem $CfgDir -Filter 'claude_desktop_config.json.bak-cds-*').Count
    $memBefore = Get-TreeSnapshot (Join-Path $docsA 'ClaudeDevStudio')
    $un = Join-Path $Inst 'Uninstall.exe'
    $t0 = Get-Date
    $r = Invoke-Tool $un '/S' 120
    # The NSIS uninstaller copies itself to %TEMP%\~nsu*.tmp\ and runs from there, so
    # Uninstall.exe returns at once: wait until no process runs from that folder.
    $deadline = (Get-Date).AddMinutes(10)
    $names = @{}
    do {
        Start-Sleep -Seconds 2
        $copies = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $path = $null; try { $path = $_.Path } catch { }
            ($path -and $path -like '*\~nsu*') -or $_.Name -like 'Au_*' -or $_.Name -like 'Un_*' })
        foreach ($c in $copies) { $names[$c.Name] = $c.Path }
        $running = $copies.Count
    } while (($running -gt 0 -or ((Get-Date) - $t0).TotalSeconds -lt 6) -and (Get-Date) -lt $deadline)
    Log "    uninstaller copies seen: $(($names.GetEnumerator() | ForEach-Object { "$($_.Key) ($($_.Value))" }) -join ', ')"
    if ($names.Count -eq 0) {
        # Not seen (finished very fast, or another name): wait for Uninstall.exe to go instead.
        $until = (Get-Date).AddMinutes(3)
        while ((Test-Path $un) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 2 }
    }
    Start-Sleep -Seconds 2
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    Check $S 'uninstaller /S ran to the end' ($r.code -eq 0 -and $running -eq 0) "exit $($r.code); finished after $secs s"
    $unLog = Join-Path $env:TEMP 'ClaudeDevStudio-uninstall.log'
    if (Test-Path $unLog) { Copy-Item $unLog (Join-Path $Res 'C-uninstall.log') -Force }
    Check-Config $S 'expect-none' 'config: CDS entries gone; keep-me, preferences, someOtherSetting remain; no BOM'
    $bakAfter = @(Get-ChildItem $CfgDir -Filter 'claude_desktop_config.json.bak-cds-*').Count
    Check $S 'config backed up before the uninstall changed it' ($bakAfter -eq $bakBefore + 1) "backups: $bakBefore before, $bakAfter after"
    $memAfter = Get-TreeSnapshot (Join-Path $docsA 'ClaudeDevStudio')
    Check $S 'memory folder under Documents untouched' (($memBefore -eq $memAfter) -and $memBefore -ne '(missing)') "$(@($memBefore -split "`n").Count) items in $docsA\ClaudeDevStudio, same before and after"
    $keys = Join-Path $Inst 'mcp-server\qwen_config.json'
    Check $S 'keys file: removed with the install folder (as documented)' (-not (Test-Path $keys)) "qwen_config.json exists after uninstall: $(Test-Path $keys)"
    $left = @(Get-ChildItem -LiteralPath $Inst -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($Inst.Length) })
    Check $S 'no CDS files left in the install folder' ((-not (Test-Path $Inst)) -or $left.Count -eq 0) $(if (Test-Path $Inst) { "left: $($left -join ', ')" } else { "$Inst removed" })
    Check-Path $S $pathBeforeCds 'user PATH: exactly as before CDS was added (Node.js, which stays, keeps its npm folder)'
    $reg = (Test-Path 'HKCU:\Software\ClaudeDevStudio') -or (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaudeDevStudio') -or [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).ClaudeDevStudio)
    $menu = Test-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'ClaudeDevStudio')
    Check $S 'registry entries and Start menu folder removed' ((-not $reg) -and (-not $menu)) "registry left: $reg; Start menu folder left: $menu"
    Check $S 'kept on purpose: Node.js and .NET runtime still installed' ((Test-Path $Node) -and (Test-Path "$env:ProgramFiles\dotnet\shared\Microsoft.WindowsDesktop.App")) "node: $(Test-Path $Node); .NET Desktop: $(@(Get-ChildItem "$env:ProgramFiles\dotnet\shared\Microsoft.WindowsDesktop.App" -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"

    # ---------------------------------------------------------------- D. Documents redirected
    $S = 'D'
    Log '=== D. Documents redirected ==='
    $plainBefore = Get-TreeSnapshot $PlainDocs
    New-Item -ItemType Directory -Force -Path $Redirected | Out-Null
    New-ItemProperty -Path $UserShellFolders -Name 'Personal' -Value $Redirected -PropertyType ExpandString -Force | Out-Null
    New-ItemProperty -Path $ShellFolders -Name 'Personal' -Value $Redirected -PropertyType String -Force | Out-Null
    $docsD = Get-Docs
    Check $S 'MyDocuments (new process) returns RedirectedDocs' ($docsD -eq $Redirected) "GetFolderPath('MyDocuments') = $docsD"
    Run-Installer $S
    Check-Program $S
    Check-Config $S 'expect-cds' 'config: both CDS entries added again; keep-me, preferences, someOtherSetting unchanged'
    Run-Smoke $S
    Probe-Memory $S 'SandboxProjD' $Redirected
    Check $S 'installer made its data folders under RedirectedDocs' ((Test-Path "$Redirected\ClaudeDevStudio\Projects") -and (Test-Path "$Redirected\ClaudeDevStudio\Backups")) "Projects: $(Test-Path "$Redirected\ClaudeDevStudio\Projects"); Backups: $(Test-Path "$Redirected\ClaudeDevStudio\Backups")"
    Stop-CdsProcesses
    $plainAfter = Get-TreeSnapshot $PlainDocs
    $diff = @(Compare-Object @($plainBefore -split "`n") @($plainAfter -split "`n") | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" })
    Check $S 'nothing CDS-related created or changed in C:\Users\WDAGUtilityAccount\Documents' ($diff.Count -eq 0) $(if ($diff.Count) { $diff -join ' | ' } else { "$(@($plainBefore -split "`n").Count) items, same before and after D" })
} catch {
    Check 'X' 'test script ran without an exception' $false "$($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
}

if (Test-Path (Join-Path $Inst 'install.log')) { Copy-Item (Join-Path $Inst 'install.log') (Join-Path $Res 'D-install.log') -Force }
Save-Results $true
Log "Done: $(@($Checks | Where-Object { $_.result -eq 'PASS' }).Count) passed, $(@($Checks | Where-Object { $_.result -ne 'PASS' }).Count) failed. Shutting down."
Start-Sleep -Seconds 3
shutdown.exe /s /t 0
