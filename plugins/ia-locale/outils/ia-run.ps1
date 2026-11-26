# ia-run.ps1 — run one development task with the LOCAL agent (OpenCode + Ollama) in an
# isolated git worktree, with a time limit, and log it for ia-usage.ps1.
# Never commits, never pushes, never merges: the caller reviews the diff and the tests.
#
#   ia-run.ps1 -Repo <path> -Task "<text>" [-Model ollama/<name>] [-Branch <name>] [-Minutes 30]
#
# Needs: $env:AI_ROOT (where the local AI lives), an `opencode` launcher that keeps its
# data under $env:AI_ROOT (see SKILL.md), Ollama listening on 127.0.0.1 only.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Task,
  [string]$Model = '',
  [string]$Branch = '',
  [int]$Minutes = 30,
  [string]$Launcher = ''
)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
if (-not $Launcher) { $Launcher = Join-Path $root 'scripts\opencode-local.ps1' }
if (-not (Test-Path $Launcher)) { throw "Launcher not found: $Launcher" }
$repoPath = (Resolve-Path $Repo).Path
$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
if (-not $Branch) { $Branch = "ia-locale/$id" }
$ws = Join-Path $root "workspaces\run-$id"
git -C $repoPath worktree add -q -b $Branch $ws | Out-Null

$log = Join-Path $root 'logs\runs.jsonl'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$agentArgs = @('run')
if ($Model) { $agentArgs += @('--model', $Model) }
$agentArgs += $Task
$t0 = Get-Date
$job = Start-Job -ScriptBlock { param($l, $w, $a) Set-Location $w; & $l @a 2>&1 | Out-String } -ArgumentList $Launcher, $ws, $agentArgs
$done = Wait-Job $job -Timeout ($Minutes * 60)
$status = 'done'
if (-not $done) { Stop-Job $job; $status = 'timeout' }
$out = Receive-Job $job -ErrorAction SilentlyContinue | Out-String
Remove-Job $job -Force
$changed = @(git -C $ws status --porcelain).Count
$entry = [ordered]@{
  id = $id; at = $t0.ToUniversalTime().ToString('o'); seconds = [int]((Get-Date) - $t0).TotalSeconds
  status = $status; model = $(if ($Model) { $Model } else { 'default' }); branch = $Branch
  files_changed = $changed; worktree = "workspaces\run-$id"
}
($entry | ConvertTo-Json -Compress) | Add-Content -Path $log -Encoding utf8
Set-Content -Path (Join-Path $root "logs\run-$id.txt") -Value $out -Encoding utf8
$entry | ConvertTo-Json
Write-Output "Agent output: logs\run-$id.txt. Review: git -C `"$ws`" diff ; then run the project's own tests. Nothing was committed."
