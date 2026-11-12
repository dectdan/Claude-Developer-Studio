# Reports on a phase started by run-phase.ps1: running or finished, the model it
# really used, tool calls so far, the latest thing it said, permission denials, and,
# when finished, its final result (and whether that result asks a question).
#
#   powershell -File tools\phase\phase-status.ps1 -Project D:\Projects\ClaudeDevStudio -Phase P2
#
# REPLACED FROM P7 by the workbench tool claudedev_phase_status (mcp-server\cds-phase.js). Kept
# as it was; it also reads runs started by the tools (their .json keeps "pid" = the runner's pid,
# "started" and "log"; a reply is appended to the same log, so this shows the newest result).
param(
  [Parameter(Mandatory)][string]$Project,
  [Parameter(Mandatory)][string]$Phase,
  [int]$Recent = 3
)
$docs = Join-Path $Project 'docs'
$log = Join-Path $docs "$($Phase)_run.log"
$err = Join-Path $docs "$($Phase)_run.err"
$meta = Join-Path $docs "$($Phase)_run.json"
if (-not (Test-Path $meta)) { "No run recorded for $Phase."; exit 1 }
$m = Get-Content $meta -Raw | ConvertFrom-Json
$alive = [bool](Get-Process -Id $m.pid -ErrorAction SilentlyContinue)
$mins = [int]((Get-Date) - [datetime]$m.started).TotalMinutes

$events = @()
if (Test-Path $log) {
  # The running session holds the log open for writing: read it with shared access.
  $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
  $all = $sr.ReadToEnd(); $sr.Close()
  foreach ($line in ($all -split "`n")) {
    if ($line.Trim()) { try { $events += ($line | ConvertFrom-Json) } catch { } }
  }
}
$init = $events | Where-Object { $_.type -eq 'system' -and $_.subtype -eq 'init' } | Select-Object -First 1
$result = $events | Where-Object { $_.type -eq 'result' } | Select-Object -Last 1
$assistant = @($events | Where-Object { $_.type -eq 'assistant' })
$toolUses = 0; $texts = @()
foreach ($a in $assistant) {
  foreach ($c in $a.message.content) {
    if ($c.type -eq 'tool_use') { $toolUses++ }
    elseif ($c.type -eq 'text' -and $c.text.Trim()) { $texts += $c.text.Trim() }
  }
}
$denied = @($events | Where-Object { $_.type -eq 'user' } | ForEach-Object { $_.message.content } |
  Where-Object { $_.type -eq 'tool_result' -and $_.is_error -and ("$($_.content)" -match 'permission|not allowed|denied') })

function Short([string]$s, [int]$n) { $t = ($s -replace '\s+', ' ').Trim(); if ($t.Length -gt $n) { $t.Substring(0, $n) + '...' } else { $t } }

$state = if ($result) { 'FINISHED' } elseif ($alive) { 'RUNNING' } else { 'STOPPED (no result)' }
"=== $Phase : $state after $mins min ==="
if ($init) { "model: $($init.model) | tools: $(@($init.tools).Count) | mcp: $(($init.mcp_servers | ForEach-Object { "$($_.name)=$($_.status)" }) -join ', ')" }
"tool calls so far: $toolUses | permission problems: $($denied.Count)"
foreach ($d in ($denied | Select-Object -Last 3)) { "  denied: " + (Short "$($d.content)" 200) }
if ($texts.Count) { "--- latest from Claude:"; foreach ($t in ($texts | Select-Object -Last $Recent)) { "  " + (Short $t 400) } }
if ($result) {
  "--- result: subtype=$($result.subtype) is_error=$($result.is_error) turns=$($result.num_turns) duration=$([int]($result.duration_ms/60000)) min"
  $r = "$($result.result)"
  "  " + (Short $r 800)
  if ($r -match '\?\s*$' -or $r -match '(?i)\b(should I|do you want|which (one|option)|please confirm|waiting for)\b') {
    "!!! The result looks like a QUESTION. Answer with: claude -p --resume $($result.session_id) ..."
  }
}
if ((Test-Path $err) -and (Get-Item $err).Length -gt 0) { "--- stderr (last lines):"; Get-Content $err -Tail 5 | ForEach-Object { "  $_" } }
