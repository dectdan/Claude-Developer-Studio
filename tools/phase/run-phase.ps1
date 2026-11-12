# Starts a phased Claude Code session headless, in the background, the way the CDS
# producer runs phases (docs\GROUND_TRUTH.md section 9). P8 turns this into CDS tools.
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
$allowed = 'Read,Edit,Write,MultiEdit,Glob,Grep,Bash,PowerShell,TodoWrite,NotebookEdit,WebFetch,WebSearch,' +
  'mcp__claudedevstudio__claudedev_load,mcp__claudedevstudio__claudedev_record_activity,' +
  'mcp__claudedevstudio__claudedev_record_mistake,mcp__claudedevstudio__claudedev_check_mistake,' +
  'mcp__claudedevstudio__claudedev_stats,mcp__claudedevstudio__claudedev_chat_checkpoint,' +
  'mcp__claudedevstudio__claudedev_handoff,mcp__claudedevstudio__claudedev_record_decision'

$claude = (Get-Command claude -ErrorAction Stop).Source
$q = { param($s) '"' + ($s -replace '"', '\"') + '"' }
$cmd = "cd /d $(& $q $Project) && $(& $q $claude) -p $(& $q $Prompt) --model $Model --effort $Effort " +
  "--permission-mode acceptEdits --allowedTools $(& $q $allowed) --mcp-config $(& $q $mcp) " +
  "--output-format stream-json --verbose < NUL > $(& $q $log) 2> $(& $q $err)"
$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', $cmd -WindowStyle Hidden -PassThru

@{ phase = $Phase; pid = $p.Id; started = (Get-Date).ToString('o'); model = $Model; effort = $Effort; log = $log } |
  ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($meta, $_, [Text.UTF8Encoding]::new($false)) }
"Started $Phase (cmd PID $($p.Id)) in $Project on $Model / $Effort. Log: $log"
