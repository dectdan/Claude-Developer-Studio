# Starts a phased Claude Code session headless, in the background, the way the CDS
# producer runs phases (docs\GROUND_TRUTH.md section 9).
#
# REPLACED FROM P7 by the workbench tools claudedev_phase_start / _status / _reply / _stop
# (mcp-server\cds-phase.js), which do the same from a chat, with a project lock, a runner that
# outlives Claude Desktop, and stop. This script is kept as it was and still works; the tools
# read its docs\<Phase>_run.json too (status, stop, reply), and both refuse to start while the
# other's run is alive in the same project (this script checks only its own phase's .json).
#
#   powershell -File tools\phase\run-phase.ps1 -Project D:\Projects\ClaudeDevStudio -Phase P2
#
# Output: docs\<Phase>_run.log (stream-json, one event per line), docs\<Phase>_run.err,
# docs\<Phase>_run.json (pid, session, start time). Check it with phase-status.ps1.
param(
  [Parameter(Mandatory)][string]$Project,
  [Parameter(Mandatory)][string]$Phase,
  [string]$Model = 'claude-opus-5-5',
  [string]$Effort = 'high',
  [string]$Prompt = ''
)
$ErrorActionPreference = 'Stop'
$docs = Join-Path $Project 'docs'
$promptFile = Join-Path $docs "$($Phase)_prompt.md"
if (-not (Test-Path $promptFile)) { throw "No prompt file: $promptFile" }
$log = Join-Path $docs "$($Phase)_run.log"
$err = Join-Path $docs "$($Phase)_run.err"
$meta = Join-Path $docs "$($Phase)_run.json"

# One session per project at a time.
if (Test-Path $meta) {
  $m = Get-Content $meta -Raw | ConvertFrom-Json
  if ($m.pid -and (Get-Process -Id $m.pid -ErrorAction SilentlyContinue)) { throw "$Phase is already running (PID $($m.pid))." }
}

# The CDS memory server, so the phase can call claudedev_load and record its work.
$node = (Get-Command node -ErrorAction Stop).Source
$index = Join-Path $env:LOCALAPPDATA 'ClaudeDevStudio\mcp-server\index.js'
$mcp = Join-Path $env:TEMP "cds_phase_mcp_$Phase.json"
@{ mcpServers = @{ claudedevstudio = @{ command = $node; args = @($index) } } } | ConvertTo-Json -Depth 5 |
  ForEach-Object { [IO.File]::WriteAllText($mcp, $_, [Text.UTF8Encoding]::new($false)) }

if (-not $Prompt) {
  $Prompt = "Read docs\$($Phase)_prompt.md and carry it out. You are running unattended: nobody can answer questions. Follow the prompt's rules for decisions it doesn't cover."
}
# P8: Monitor (it watches a background command or a WebSocket; its commands follow Bash's rules).
$allowed = 'Read,Edit,Write,MultiEdit,Glob,Grep,Bash,PowerShell,Monitor,TodoWrite,NotebookEdit,WebFetch,WebSearch,' +
  'mcp__claudedevstudio__claudedev_load,mcp__claudedevstudio__claudedev_record_activity,' +
  'mcp__claudedevstudio__claudedev_record_mistake,mcp__claudedevstudio__claudedev_check_mistake,' +
  'mcp__claudedevstudio__claudedev_stats,mcp__claudedevstudio__claudedev_chat_checkpoint,' +
  'mcp__claudedevstudio__claudedev_handoff,mcp__claudedevstudio__claudedev_record_decision'

# P8, as cds-phase.js: wait up to 60 idle minutes for background work after the last turn, and let a
# foreground command be given a timeout of up to 60 minutes (both default to 10). The user's own
# values win. cmd.exe and Claude Code inherit them from this process.
foreach ($v in 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'BASH_MAX_TIMEOUT_MS') {
  if (-not [Environment]::GetEnvironmentVariable($v)) { [Environment]::SetEnvironmentVariable($v, '3600000') }
}

$claude = (Get-Command claude -ErrorAction Stop).Source
$q = { param($s) '"' + ($s -replace '"', '\"') + '"' }
$cmd = "cd /d $(& $q $Project) && $(& $q $claude) -p $(& $q $Prompt) --model $Model --effort $Effort " +
  "--permission-mode acceptEdits --allowedTools $(& $q $allowed) --mcp-config $(& $q $mcp) " +
  "--output-format stream-json --verbose < NUL > $(& $q $log) 2> $(& $q $err)"
$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $cmd -WindowStyle Hidden -PassThru

@{ phase = $Phase; pid = $p.Id; started = (Get-Date).ToString('o'); model = $Model; effort = $Effort; log = $log } |
  ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($meta, $_, [Text.UTF8Encoding]::new($false)) }
"Started $Phase (cmd PID $($p.Id)) in $Project on $Model / $Effort. Log: $log"
