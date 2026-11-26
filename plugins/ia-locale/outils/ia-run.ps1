# ia-run.ps1 — one LOCAL worker session: one task, one git worktree, one branch, a time limit.
# The local agent (OpenCode on a local engine) edits files in its own worktree and stops.
# It never commits, never pushes, never merges; by default it cannot run shell commands.
# The caller (an orchestrator session, a script, a human) reads the short result, the diff,
# and runs the project's own tests: the agent's "it works" is not a proof.
#
#   ia-run.ps1 -Repo <path> (-Task "<text>" | -BriefFile <file>) [-TaskId PRJ-12] [-Model <provider/name>]
#              [-Base <branch>] [-Branch <name>] [-Minutes 30] [-AllowShell] [-EvenInCall]
#   ia-run.ps1 -Status [-Id <run id>]      state of the running or last run, as JSON
#
# The machine stays usable: a start is refused while the microphone is in use (a call is on),
# unless -EvenInCall. One local worker at a time per machine (one model fits in memory): a second start is refused
# while a run is alive. Needs $env:AI_ROOT and the launcher $AI_ROOT\scripts\opencode-local.ps1.
# Files: $AI_ROOT\logs\run-<id>.json (state), run-<id>.txt (agent output), runs.jsonl (history).
[CmdletBinding(DefaultParameterSetName = 'run')]
param(
  [Parameter(ParameterSetName = 'run', Mandatory = $true)][string]$Repo,
  [Parameter(ParameterSetName = 'run')][string]$Task = '',
  [Parameter(ParameterSetName = 'run')][string]$BriefFile = '',
  [Parameter(ParameterSetName = 'run')][string]$TaskId = '',
  [Parameter(ParameterSetName = 'run')][string]$Model = '',
  [Parameter(ParameterSetName = 'run')][string]$Base = '',
  [Parameter(ParameterSetName = 'run')][string]$Branch = '',
  [Parameter(ParameterSetName = 'run')][int]$Minutes = 30,
  [Parameter(ParameterSetName = 'run')][switch]$AllowShell,
  [Parameter(ParameterSetName = 'run')][switch]$EvenInCall,
  [Parameter(ParameterSetName = 'run')][string]$Launcher = '',
  [Parameter(ParameterSetName = 'status', Mandatory = $true)][switch]$Status,
  [Parameter(ParameterSetName = 'status')][string]$Id = ''
)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
$lock = Join-Path $logs 'run.lock'
$utf8 = New-Object Text.UTF8Encoding($false)

function Get-LiveRun {
  if (-not (Test-Path $lock)) { return $null }
  $l = Get-Content $lock -Raw | ConvertFrom-Json
  if (Get-Process -Id $l.pid -ErrorAction SilentlyContinue) { return $l }
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  return $null
}

# A call in progress = the microphone is in use (Windows records it per app, no admin needed).
function Test-CallInProgress {
  $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
  if (-not (Test-Path $base)) { return $false }
  $keys = @(Get-ChildItem $base -Recurse -ErrorAction SilentlyContinue)
  foreach ($k in $keys) {
    $v = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if ($v -and $v.PSObject.Properties['LastUsedTimeStop'] -and $v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0) { return $true }
  }
  return $false
}

if ($Status) {
  if (-not $Id) {
    $live = Get-LiveRun
    if ($live) { $Id = $live.id }
    else { $last = Get-ChildItem $logs -Filter 'run-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1; if ($last) { $Id = $last.BaseName.Substring(4) } }
  }
  if (-not $Id) { Write-Output '{"status":"none"}'; exit 0 }
  Get-Content (Join-Path $logs "run-$Id.json") -Raw
  exit 0
}

if (-not $Task -and -not $BriefFile) { throw 'Give -Task or -BriefFile.' }
if ($BriefFile) { $Task = [IO.File]::ReadAllText((Resolve-Path $BriefFile).Path) }
if (-not $EvenInCall -and (Test-CallInProgress)) { throw 'Refused: a call is in progress (microphone in use). Start again after the call, or pass -EvenInCall.' }
$live = Get-LiveRun
if ($live) { throw "Local worker busy: run $($live.id) (task '$($live.task_id)') is still running. One local session at a time." }
if (-not $Launcher) { $Launcher = Join-Path $root 'scripts\opencode-local.ps1' }
if (-not (Test-Path $Launcher)) { throw "Launcher not found: $Launcher" }

$repoPath = (Resolve-Path $Repo).Path
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
if (-not $Branch) { $Branch = "ia-locale/$runId" }
$ws = Join-Path $root "workspaces\run-$runId"
$wtArgs = @('-C', $repoPath, 'worktree', 'add', '-q', '-b', $Branch, $ws); if ($Base) { $wtArgs += $Base }
& git @wtArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed (exit $LASTEXITCODE)." }
$baseSha = (& git -C $ws rev-parse --short HEAD)

$state = [ordered]@{
  id = $runId; task_id = $TaskId; at = (Get-Date).ToUniversalTime().ToString('o'); status = 'running'
  model = $(if ($Model) { $Model } else { 'default' }); worker = "local:$(if ($Model) { $Model } else { 'default' })"
  machine = $env:COMPUTERNAME; branch = $Branch; base = $baseSha; worktree = $ws; minutes_limit = $Minutes
  shell_allowed = [bool]$AllowShell; seconds = 0; files_changed = 0; diffstat = ''; output = (Join-Path $logs "run-$runId.txt")
}
$stateFile = Join-Path $logs "run-$runId.json"
function Save-State { [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json), $utf8) }
Save-State
[IO.File]::WriteAllText($lock, (@{ id = $runId; task_id = $TaskId; pid = $PID } | ConvertTo-Json -Compress), $utf8)

$rules = @"

Rules for this session: you work only inside the current directory. Edit files; do not commit, push, merge or delete branches. Do not read or print secrets (.env, keys, credentials). When done, end with a short report: what you changed (files), what you did not do, what the reviewer must check.
"@
$permission = if ($AllowShell) { '{"edit":"allow","bash":"allow","webfetch":"deny"}' } else { '{"edit":"allow","bash":"deny","webfetch":"deny"}' }
$agentArgs = @('run'); if ($Model) { $agentArgs += @('--model', $Model) }; $agentArgs += ($Task + $rules)
$pidFile = Join-Path $logs "run-$runId.pid"
$t0 = Get-Date
$job = Start-Job -ScriptBlock {
  param($l, $w, $a, $perm, $pf)
  Set-Content -Path $pf -Value $PID
  $env:OPENCODE_PERMISSION = $perm
  Set-Location $w
  & $l @a 2>&1 | Out-String
} -ArgumentList $Launcher, $ws, $agentArgs, $permission, $pidFile
try {
  $done = Wait-Job $job -Timeout ($Minutes * 60)
  $state.status = 'done'
  if (-not $done) {
    $state.status = 'timeout'
    if (Test-Path $pidFile) { & taskkill /PID (Get-Content $pidFile) /T /F 2>$null | Out-Null }
    Stop-Job $job -ErrorAction SilentlyContinue
  }
  $out = Receive-Job $job -ErrorAction SilentlyContinue | Out-String
  [IO.File]::WriteAllText($state.output, $out, $utf8)
  & git -C $ws add -A -N 2>$null | Out-Null
  $state.files_changed = @(& git -C $ws status --porcelain).Count
  $state.diffstat = (& git -C $ws diff --stat | Select-Object -Last 1) -as [string]
  if ($state.status -eq 'done' -and $state.files_changed -eq 0) { $state.status = 'no_change' }
} finally {
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile, $lock -Force -ErrorAction SilentlyContinue
  $state.seconds = [int]((Get-Date) - $t0).TotalSeconds
  Save-State
  $hist = [ordered]@{ id = $runId; task_id = $TaskId; at = $state.at; seconds = $state.seconds; status = $state.status; model = $state.model; branch = $Branch; files_changed = $state.files_changed }
  ($hist | ConvertTo-Json -Compress) | Add-Content -Path (Join-Path $logs 'runs.jsonl') -Encoding utf8
}
$state | ConvertTo-Json
Write-Output "Nothing was committed. Next: git -C `"$ws`" diff ; run the project's own suites in that worktree and read each exit code."
