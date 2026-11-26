# ia-valider.ps1 — objective validation of a change, independent of the AI that made it.
# An AI saying "done" proves nothing: this script looks at the changed files, rates the risk
# from path rules, runs the checks the project declared, guards the tests against tampering,
# and writes a report. Deterministic: no model is called.
#
#   ia-valider.ps1 -Repo <worktree or repo> [-Base <ref>] [-Config <file>] [-Projet <name>] [-TaskId <ID>]
#   ia-valider.ps1 -Repo <clean worktree> -Baseline     record what already fails BEFORE the change
#
# Before/after: a check with a "fail_pattern" (regex of one failing item per log line) is compared
# with the baseline recorded on the merge-base commit. Failures already there are reported as
# pre-existing; only NEW failures fail the change. No baseline = every failure counts.
# Give the pattern one capture group for the stable part of the line (test name without its number).
#
# Config (JSON): -Config, else $AI_ROOT\config\projets\<Projet or repo folder name>\validation.json
# (see validation.exemple.json). Kept OUTSIDE the repository so an agent working in the
# worktree cannot edit its own acceptance criteria.
# Exit code: 0 = pass, 1 = fail, 2 = checks pass but a human must approve (risk level).
# Report: $AI_ROOT\logs\validation\<id>.json (+ one .log per check).
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Base = '',
  [string]$Config = '',
  [string]$Projet = '',
  [string]$TaskId = '',
  [switch]$Baseline
)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$repoPath = (Resolve-Path $Repo).Path
if (-not $Projet) { $Projet = Split-Path (& git -C $repoPath rev-parse --path-format=absolute --git-common-dir | Split-Path -Parent) -Leaf }
if (-not $Config) { $Config = Join-Path $root "config\projets\$Projet\validation.json" }
if (-not (Test-Path $Config)) { throw "No validation config: $Config (copy validation.exemple.json and adapt it)." }
$cfg = Get-Content $Config -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $Base) { $Base = if ($cfg.base) { $cfg.base } else { 'HEAD' } }
$levels = @('low', 'moderate', 'high', 'critical')
$utf8 = New-Object Text.UTF8Encoding($false)

function Convert-Glob([string]$g) {
  $r = [regex]::Escape($g.Replace('\', '/')) -replace '\\\*\\\*/', '(.*/)?' -replace '\\\*\\\*', '.*' -replace '\\\*', '[^/]*' -replace '\\\?', '[^/]'
  return "^$r$"
}
function Test-Match([string]$path, $globs) { foreach ($g in @($globs)) { if ($g -and $path -match (Convert-Glob $g)) { return $true } }; return $false }

function Get-Signature($check, [string]$log) {
  if (-not $check.fail_pattern -or -not (Test-Path $log)) { return @() }
  @(Get-Content $log -Encoding utf8 | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m', '' } | ForEach-Object { if ($_ -match $check.fail_pattern) { if ($Matches.Count -gt 1) { $Matches[1].Trim() } else { $Matches[0].Trim() } } } | Sort-Object -Unique)
}
function Get-BaselineFile([string]$sha, [string]$name) {
  $d = Join-Path $root "cache\validation\$Projet"; New-Item -ItemType Directory -Force $d | Out-Null
  Join-Path $d ("{0}-{1}.txt" -f $sha.Substring(0, [math]::Min(12, $sha.Length)), ($name -replace '[^\w.-]', '_'))
}

# --- what changed (committed since base + working tree + untracked) ----------------------
$mergeBase = (& git -C $repoPath merge-base $Base HEAD 2>$null); if (-not $mergeBase) { $mergeBase = $Base }
$status = @(& git -C $repoPath -c core.quotepath=false diff --name-status $mergeBase) + @(& git -C $repoPath -c core.quotepath=false ls-files --others --exclude-standard | ForEach-Object { "A`t$_" })
$changes = @($status | Where-Object { $_ } | ForEach-Object { $p = $_ -split "`t"; [pscustomobject]@{ kind = $p[0].Substring(0, 1); path = $p[-1] } } | Sort-Object path -Unique)
$files = @($changes | Where-Object kind -ne 'D' | ForEach-Object path)
$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$dir = Join-Path $root 'logs\validation'; New-Item -ItemType Directory -Force $dir | Out-Null
$findings = New-Object System.Collections.Generic.List[object]
function Add-Finding($severity, $rule, $detail) { $findings.Add([pscustomobject]@{ severity = $severity; rule = $rule; detail = $detail }) }

# --- risk level -------------------------------------------------------------------------
$risk = 'low'; $riskWhy = @()
foreach ($c in $changes) {
  foreach ($r in @($cfg.risk)) {
    if (Test-Match $c.path $r.paths) {
      if ($levels.IndexOf($r.level) -gt $levels.IndexOf($risk)) { $risk = $r.level }
      $riskWhy += "$($r.level): $($c.path)"
    }
  }
}
if ($risk -eq 'low' -and @($changes | Where-Object { -not (Test-Match $_.path $cfg.low_risk) }).Count) { $risk = 'moderate' }

# --- forbidden paths --------------------------------------------------------------------
foreach ($c in $changes) { if (Test-Match $c.path $cfg.forbidden) { Add-Finding 'fail' 'forbidden-path' $c.path } }

# --- test tampering guard ---------------------------------------------------------------
$skipPattern = '^\+.*(markTestSkipped|markTestIncomplete|\.skip\(|\.only\(|\bxit\(|\bxdescribe\(|\bfit\(|\bfdescribe\(|test\.todo\(|@group\s+skip|--no-verify)'
foreach ($c in $changes | Where-Object { Test-Match $_.path $cfg.tests }) {
  if ($c.kind -eq 'D') { Add-Finding 'fail' 'test-deleted' $c.path; continue }
  $diff = @(& git -C $repoPath diff $mergeBase -- $c.path)
  $skips = @($diff | Where-Object { $_ -match $skipPattern })
  if ($skips.Count) { Add-Finding 'fail' 'test-disabled' "$($c.path): $($skips[0].Trim())" }
  $minus = @($diff | Where-Object { $_ -match '^-[^-].*(assert\w*\(|expect\(|->expects\()' }).Count
  $plus = @($diff | Where-Object { $_ -match '^\+[^+].*(assert\w*\(|expect\(|->expects\()' }).Count
  if ($minus -gt $plus) { Add-Finding 'human' 'assertions-removed' "$($c.path): $minus assertion line(s) removed, $plus added" }
  elseif ($c.kind -eq 'M' -and $minus -gt 0) { Add-Finding 'human' 'assertions-changed' "$($c.path): $minus assertion line(s) rewritten" }
}
foreach ($c in $changes | Where-Object { Test-Match $_.path $cfg.acceptance_files }) { Add-Finding 'human' 'acceptance-criteria-changed' $c.path }

# --- checks -----------------------------------------------------------------------------
function Invoke-Check([string]$name, [string]$cmd, [int]$timeout) {
  $log = Join-Path $dir "$id-$($name -replace '[^\w.-]', '_').log"
  $t0 = Get-Date
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', "($cmd) > `"$log`" 2>&1" -WorkingDirectory $repoPath -WindowStyle Hidden -PassThru
  if (-not $p.WaitForExit($timeout * 1000)) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null; $code = -1; $state = 'timeout' }
  else { $code = $p.ExitCode; $state = if ($code -eq 0) { 'pass' } else { 'fail' } }
  [pscustomobject]@{ name = $name; status = $state; exit_code = $code; seconds = [int]((Get-Date) - $t0).TotalSeconds; command = $cmd; log = $log }
}
if ($Baseline) {
  if (@(& git -C $repoPath status --porcelain --untracked-files=no).Count) { throw 'Baseline needs a clean worktree (no modified tracked file).' }
  $sha = (& git -C $repoPath rev-parse HEAD)
  try {
    foreach ($st in @($cfg.setup)) { if ($st) { Invoke-Check 'setup' $st 120 | Out-Null } }
    foreach ($k in @($cfg.checks | Where-Object { $_.fail_pattern })) {
      $bf = Get-BaselineFile $sha $k.name
      if (Test-Path $bf) { Write-Output ("baseline {0}: already recorded for {1}" -f $k.name, $sha.Substring(0, 10)); continue }
      $timeout = if ($k.timeout) { [int]$k.timeout } else { 600 }
      $r = Invoke-Check $k.name ($k.cmd.Replace('{files}', '')) $timeout
      $sig = @(Get-Signature $k $r.log)
      [IO.File]::WriteAllLines($bf, [string[]]$sig, $utf8)
      Write-Output ("baseline {0}: {1}, exit {2}, {3} failing item(s) already there, {4}s" -f $k.name, $r.status, $r.exit_code, $sig.Count, $r.seconds)
    }
  } finally { foreach ($st in @($cfg.teardown)) { if ($st) { Invoke-Check 'teardown' $st 120 | Out-Null } } }
  exit 0
}
$results = New-Object System.Collections.Generic.List[object]
try {
  foreach ($s in @($cfg.setup)) { if ($s) { $r = Invoke-Check 'setup' $s 120; if ($r.status -ne 'pass') { $results.Add($r) } } }
  foreach ($k in @($cfg.checks)) {
    $min = if ($k.min_level) { $k.min_level } else { 'low' }
    $hit = @($files | Where-Object { Test-Match $_ $k.when })
    if (-not $hit.Count -or $levels.IndexOf($risk) -lt $levels.IndexOf($min)) { continue }
    $timeout = if ($k.timeout) { [int]$k.timeout } else { 600 }
    if ($k.cmd -match '\{file\}') {
      $bad = New-Object System.Collections.Generic.List[string]; $t0 = Get-Date; $firstLog = ''
      foreach ($f in $hit) { $r = Invoke-Check "$($k.name)" ($k.cmd.Replace('{file}', "`"$f`"")) $timeout; if ($r.status -ne 'pass') { $bad.Add($f); if (-not $firstLog) { $keep = "$($r.log).first-failure"; Copy-Item $r.log $keep -Force; $firstLog = $keep } } }
      $results.Add([pscustomobject]@{ name = $k.name; status = $(if ($bad.Count) { 'fail' } else { 'pass' }); exit_code = $bad.Count; seconds = [int]((Get-Date) - $t0).TotalSeconds; command = "$($k.cmd)  x $($hit.Count) file(s)"; log = $firstLog; failed_files = @($bad) })
    } else {
      $r = Invoke-Check $k.name ($k.cmd.Replace('{files}', (($hit | ForEach-Object { "`"$_`"" }) -join ' '))) $timeout
      if ($r.status -eq 'fail' -and $k.fail_pattern) {
        $bf = Get-BaselineFile "$mergeBase" $k.name
        if (Test-Path $bf) {
          $before = @(Get-Content $bf -Encoding utf8); $after = @(Get-Signature $k $r.log)
          $fresh = @($after | Where-Object { $before -notcontains $_ })
          $r | Add-Member -NotePropertyName preexisting -NotePropertyValue ($after.Count - $fresh.Count)
          $r | Add-Member -NotePropertyName new_failures -NotePropertyValue $fresh
          if ($after.Count -and -not $fresh.Count) { $r.status = 'pass'; $r | Add-Member -NotePropertyName note -NotePropertyValue 'only pre-existing failures (same as baseline)' }
        } else { $r | Add-Member -NotePropertyName note -NotePropertyValue 'no baseline recorded for the merge-base: every failure counts' }
      }
      $results.Add($r)
    }
  }
} finally {
  foreach ($s in @($cfg.teardown)) { if ($s) { Invoke-Check 'teardown' $s 120 | Out-Null } }
}
foreach ($r in @($results.ToArray() | Where-Object status -ne 'pass')) { Add-Finding 'fail' "check:$($r.name)" "$($r.status), exit $($r.exit_code), log $($r.log)" }

# --- verdict ----------------------------------------------------------------------------
$humanFrom = if ($cfg.human_from) { $cfg.human_from } else { 'high' }
$verdict = 'pass'
if ($levels.IndexOf($risk) -ge $levels.IndexOf($humanFrom)) { $verdict = 'human_required'; Add-Finding 'human' 'risk-level' "risk '$risk' needs a human approval even when every check passes" }
if (@($findings.ToArray() | Where-Object severity -eq 'human').Count) { $verdict = 'human_required' }
if (@($findings.ToArray() | Where-Object severity -eq 'fail').Count) { $verdict = 'fail' }
if (-not $changes.Count) { $verdict = 'fail'; Add-Finding 'fail' 'no-change' "nothing changed against $Base" }

$report = [ordered]@{
  id = $id; at = (Get-Date).ToUniversalTime().ToString('o'); task_id = $TaskId; project = $Projet
  head = (& git -C $repoPath rev-parse --short HEAD); base = "$Base"; merge_base = "$mergeBase".Substring(0, [math]::Min(10, "$mergeBase".Length))
  verdict = $verdict; risk = $risk; risk_reasons = @($riskWhy | Select-Object -First 10)
  files_changed = $changes.Count; checks = $results.ToArray(); findings = $findings.ToArray(); config = $Config
}
$reportFile = Join-Path $dir "$id.json"
[IO.File]::WriteAllText($reportFile, ($report | ConvertTo-Json -Depth 6), $utf8)
(([ordered]@{ id = $id; at = $report.at; task_id = $TaskId; project = $Projet; verdict = $verdict; risk = $risk; files_changed = $changes.Count; checks_failed = @($results.ToArray() | Where-Object status -ne 'pass').Count }) | ConvertTo-Json -Compress) | Add-Content -Path (Join-Path $root 'logs\validations.jsonl') -Encoding utf8

Write-Output ("VERDICT {0} | risk {1} | {2} file(s) | report {3}" -f $verdict.ToUpper(), $risk, $changes.Count, $reportFile)
foreach ($r in $results) {
  Write-Output ("  [{0}] {1} (exit {2}, {3}s){4}" -f $r.status, $r.name, $r.exit_code, $r.seconds, $(if ($r.PSObject.Properties['note']) { " — $($r.note)" } else { '' }))
  if ($r.PSObject.Properties['new_failures']) { foreach ($n in @($r.new_failures | Select-Object -First 10)) { Write-Output "      NEW: $n" } }
}
foreach ($f in $findings) { Write-Output ("  {0}: {1} — {2}" -f $f.severity.ToUpper(), $f.rule, $f.detail) }
switch ($verdict) { 'pass' { exit 0 } 'fail' { exit 1 } default { exit 2 } }
