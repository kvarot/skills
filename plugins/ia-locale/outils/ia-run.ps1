# ia-run.ps1 — one LOCAL worker session: one task, one git worktree, one branch, a time limit.
# The local agent (OpenCode on a local engine) edits files in its own worktree and stops.
# It never commits, never pushes, never merges; by default it cannot run shell commands.
# The caller (an orchestrator session, a script, a human) reads the short result, the diff,
# and runs the project's own tests: the agent's "it works" is not a proof.
#
#   ia-run.ps1 -Repo <path> (-Task "<text>" | -BriefFile <file>) [-TaskId PRJ-12] [-Model <provider/name>]
#              [-Base <branch>] [-Branch <name>] [-Minutes 30] [-AllowShell] [-EvenInCall]
#   ia-run.ps1 -Status [-Id <run id>]      state of the running or last run, as JSON
#   ia-run.ps1 -List                       worktrees still on disk, with size and age
#   ia-run.ps1 -Clean [-Id <run id>] [-Force]   remove the worktree and branch of finished runs
#
# Disk hygiene: the change of every run is saved as a patch ($AI_ROOT\logs\run-<id>.patch), so a
# worktree is never the only copy. A run that changed nothing, timed out or failed validation removes
# its own worktree and branch at once. A successful run keeps its worktree until the caller has
# committed or rejected it, then the caller runs -Clean. At most 3 worktrees may wait: a new run is
# refused beyond that, and when the disk of $AI_ROOT has less than 15 % free.
#
# When $AI_ROOT\config\projets\<repo folder name>\validation.json exists, ia-valider.ps1 records the
# baseline before the agent starts and validates its change when it stops: the state then carries
# an objective verdict (pass | fail | human_required) and the report path. -NoValidation skips it.
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
  [Parameter(ParameterSetName = 'run')][switch]$NoValidation,
  [Parameter(ParameterSetName = 'run')][string]$Launcher = '',
  [Parameter(ParameterSetName = 'status', Mandatory = $true)][switch]$Status,
  [Parameter(ParameterSetName = 'status')][Parameter(ParameterSetName = 'clean')][string]$Id = '',
  [Parameter(ParameterSetName = 'list', Mandatory = $true)][switch]$List,
  [Parameter(ParameterSetName = 'clean', Mandatory = $true)][switch]$Clean,
  [Parameter(ParameterSetName = 'clean')][switch]$Force
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

function Get-RunStates {
  @(Get-ChildItem $logs -Filter 'run-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | ForEach-Object {
      try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { }
    } | Where-Object { $_ -and $_.worktree -and (Test-Path $_.worktree) })
}
# Removes the worktree and its branch. Returns a short text. Never loses work silently:
# uncommitted changes need -Force (the patch is on disk anyway), an unmerged branch is kept.
function Remove-Run($st, [bool]$forced) {
  $repo = if ($st.PSObject.Properties['repo'] -and $st.repo) { $st.repo } else { Split-Path (& git -C $st.worktree rev-parse --path-format=absolute --git-common-dir) -Parent }
  $dirty = @(& git -C $st.worktree status --porcelain).Count
  if ($dirty -and -not $forced) { return "kept $($st.id): $dirty uncommitted file(s) — commit them, or -Force (patch: logs\run-$($st.id).patch)" }
  $head = (& git -C $st.worktree rev-parse --short HEAD)
  & git -C $repo worktree remove --force $st.worktree 2>$null | Out-Null
  if (Test-Path $st.worktree) { Remove-Item $st.worktree -Recurse -Force -ErrorAction SilentlyContinue }
  & git -C $repo worktree prune 2>$null | Out-Null
  $msg = "removed worktree $($st.id)"
  if ($head -eq $st.base) { & git -C $repo branch -D $st.branch 2>$null | Out-Null; $msg += ', branch deleted (no commit on it)' }
  else {
    & git -C $repo branch -d $st.branch 2>$null | Out-Null
    $msg += $(if ($LASTEXITCODE -eq 0) { ', branch deleted (merged)' } else { ", branch $($st.branch) kept (commits not merged)" })
  }
  return $msg
}

if ($List) {
  $st = Get-RunStates
  if (-not $st.Count) { Write-Output 'No local worktree on disk.'; exit 0 }
  foreach ($x in $st) {
    $mb = [math]::Round(((Get-ChildItem $x.worktree -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB))
    Write-Output ("{0} | task {1} | {2} | validation {3} | {4} MB | {5:N0} h old | {6}" -f $x.id, $x.task_id, $x.status, $x.validation, $mb, ((Get-Date).ToUniversalTime() - ([datetime]$x.at).ToUniversalTime()).TotalHours, $x.worktree)
  }
  exit 0
}
if ($Clean) {
  $live = Get-LiveRun
  $st = @(Get-RunStates | Where-Object { (-not $Id -or $_.id -eq $Id) -and (-not $live -or $_.id -ne $live.id) })
  if (-not $st.Count) { Write-Output 'Nothing to clean.'; exit 0 }
  foreach ($x in $st) { Write-Output (Remove-Run $x ([bool]$Force)) }
  exit 0
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
$waiting = Get-RunStates
if ($waiting.Count -ge 3) { throw ("Refused: $($waiting.Count) local worktrees already wait on disk (" + (($waiting | ForEach-Object id) -join ', ') + "). Commit or reject them, then: ia-run.ps1 -Clean") }
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($root).Substring(0, 1))
if ($drive.Free / ($drive.Free + $drive.Used) -lt 0.15) { throw 'Refused: less than 15 % free on the disk of AI_ROOT. Clean first: ia-run.ps1 -List, ia-run.ps1 -Clean.' }
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
  machine = $env:COMPUTERNAME; repo = $repoPath; branch = $Branch; base = $baseSha; worktree = $ws; patch = ''; kept = $true; minutes_limit = $Minutes
  shell_allowed = [bool]$AllowShell; seconds = 0; files_changed = 0; diffstat = ''; output = (Join-Path $logs "run-$runId.txt")
}
$projet = Split-Path (& git -C $repoPath rev-parse --path-format=absolute --git-common-dir | Split-Path -Parent) -Leaf
$valider = Join-Path $PSScriptRoot 'ia-valider.ps1'
$validate = (-not $NoValidation) -and (Test-Path (Join-Path $root "config\projets\$projet\validation.json"))
$state.validation = $(if ($validate) { 'pending' } else { 'none' }); $state.validation_report = ''
$stateFile = Join-Path $logs "run-$runId.json"
function Save-State { [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json), $utf8) }
Save-State
[IO.File]::WriteAllText($lock, (@{ id = $runId; task_id = $TaskId; pid = $PID } | ConvertTo-Json -Compress), $utf8)

if ($validate) { $state.status = 'baseline'; Save-State; & powershell -NoProfile -File $valider -Repo $ws -Projet $projet -Baseline | Out-Null; $state.status = 'running'; Save-State }

$rules = @"

Rules for this session: you work only inside the current directory. Edit files; do not commit, push, merge or delete branches. Do not read or print secrets (.env, keys, credentials). When done, end with a short report: what you changed (files), what you did not do, what the reviewer must check.
"@
$permission = if ($AllowShell) { '{"edit":"allow","bash":"allow","webfetch":"deny","external_directory":"deny"}' } else { '{"edit":"allow","bash":"deny","webfetch":"deny","external_directory":"deny"}' }
$agentArgs = @('run'); if ($Model) { $agentArgs += @('--model', $Model) }; $agentArgs += ($Task + $rules)
$pidFile = Join-Path $logs "run-$runId.pid"
$t0 = Get-Date
$job = Start-Job -ScriptBlock {
  param($l, $w, $a, $perm, $pf)
  Set-Content -Path $pf -Value $PID
  $env:OPENCODE_PERMISSION = $perm
  Set-Location $w
  # Some agents trust the PWD variable (inherited from a POSIX shell) more than the real directory:
  # without this line the agent may write in the caller's folder instead of its worktree.
  $env:PWD = $w; Remove-Item Env:INIT_CWD, Env:OLDPWD -ErrorAction SilentlyContinue
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
  if ($state.files_changed -gt 0) {
    $state.patch = Join-Path $logs "run-$runId.patch"
    & $env:ComSpec /d /c "git -C `"$ws`" diff --binary > `"$($state.patch)`"" | Out-Null
  }
  if ($state.status -eq 'done' -and $state.files_changed -eq 0) { $state.status = 'no_change' }
  if ($state.status -ne 'done' -and $state.validation -eq 'pending') { $state.validation = 'skipped' }
  if ($validate -and $state.status -eq 'done') {
    $state.status = 'validating'; Save-State
    $v = @(& powershell -NoProfile -File $valider -Repo $ws -Projet $projet -Base $baseSha -TaskId $TaskId)
    $state.validation = switch ($LASTEXITCODE) { 0 { 'pass' } 2 { 'human_required' } default { 'fail' } }
    if ("$($v[0])" -match 'report (.+)$') { $state.validation_report = $Matches[1].Trim() }
    $state.validation_summary = @($v | Select-Object -First 12)
    $state.status = 'done'
  }
} finally {
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile, $lock -Force -ErrorAction SilentlyContinue
  $state.seconds = [int]((Get-Date) - $t0).TotalSeconds
  # Keep the worktree only when there is something for the caller to commit.
  if (-not ($state.status -eq 'done' -and $state.validation -in 'pass', 'human_required', 'none')) {
    $state.kept = $false; Save-State
    Remove-Run ([pscustomobject]$state) $true | Out-Null
  }
  Save-State
  $hist = [ordered]@{ id = $runId; task_id = $TaskId; at = $state.at; seconds = $state.seconds; status = $state.status; model = $state.model; branch = $Branch; files_changed = $state.files_changed }
  ($hist | ConvertTo-Json -Compress) | Add-Content -Path (Join-Path $logs 'runs.jsonl') -Encoding utf8
}
$state | ConvertTo-Json
if (-not $state.kept) { Write-Output "Worktree and branch removed (status $($state.status), validation $($state.validation)). The change, if any, is saved: $($state.patch)" }
elseif ($validate) { Write-Output "Nothing was committed. Validation: $($state.validation) ($($state.validation_report)). Diff: git -C `"$ws`" diff. When committed or rejected: ia-run.ps1 -Clean -Id $runId" }
else { Write-Output "Nothing was committed. No validation config for '$projet': run the project's own suites in `"$ws`" and read each exit code. When committed or rejected: ia-run.ps1 -Clean -Id $runId" }
