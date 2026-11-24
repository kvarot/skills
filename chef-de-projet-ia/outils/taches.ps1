<#
.SYNOPSIS
  Minimal task register for AI-agent orchestration: one JSONL file per project.

.DESCRIPTION
  Store: <orchestration>\projets\<PREFIX>\taches.jsonl (one JSON object per line), or -Fichier.
  Commands:
    list   [-Etat <state>]                     all tasks (or one state)
    ready                                      todo tasks whose dependencies are finished
    show   -Id PRJ-1                           one task with its evidence
    add    -Titre "..." [-Deps PRJ-1,PRJ-2] [-Zone "internal/x;web/src/y"] [-Note "..."]
    claim  -Id PRJ-1 -Par <session> [-Machine <m>] [-Zone "..."] [-Heures 4]
    set    -Id PRJ-1 -Etat <state> -Preuve "<command + exit code | verdict | sha>" [-Par <who>] [-Branche <b>]
    renew  -Id PRJ-1 [-Heures 4]               extend the area reservation
    release -Id PRJ-1 [-Note "why"]            give the task back (todo, no owner)
    zones                                      active area reservations
    stop   [-Note "why"] / start               emergency stop: no new claim while stopped

  States (proof-based): todo, doing, implemented, tests_run, tests_green, reviewed,
  accepted, merged, deployed, blocked, dropped. Every state after "doing" needs -Preuve.
  Windows PowerShell 5.1 compatible. No network.
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('list', 'ready', 'show', 'add', 'claim', 'set', 'renew', 'release', 'zones', 'stop', 'start')]
  [string]$Commande,
  [string]$Projet = 'PRJ',
  [string]$Fichier,
  [string]$Id,
  [string]$Titre,
  [string[]]$Deps = @(),
  [string]$Zone,
  [string]$Note,
  [string]$Par,
  [string]$Machine,
  [string]$Etat,
  [string]$Preuve,
  [string]$Branche,
  [double]$Heures = 4
)

$ErrorActionPreference = 'Stop'
$States = 'todo', 'doing', 'implemented', 'tests_run', 'tests_green', 'reviewed', 'accepted', 'merged', 'deployed', 'blocked', 'dropped'
$Finished = 'merged', 'deployed', 'dropped'
$Active = 'doing', 'implemented', 'tests_run', 'tests_green', 'reviewed', 'accepted'

if (-not $Fichier) { $Fichier = Join-Path (Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'projets') $Projet) 'taches.jsonl' }
$Dir = Split-Path $Fichier -Parent
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Force $Dir | Out-Null }
$StopFile = Join-Path $Dir 'STOP'
$LockFile = "$Fichier.lock"
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-Now { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Fail([string]$msg) { [Console]::Error.WriteLine("taches: $msg"); exit 1 }

function Read-Tasks {
  $list = New-Object System.Collections.ArrayList
  if (Test-Path $Fichier) {
    foreach ($line in [IO.File]::ReadAllLines($Fichier, $Utf8)) {
      if ($line.Trim()) {
        $t = $line | ConvertFrom-Json
        $t.deps = @($t.deps | Where-Object { $_ })
        $t.evidence = @($t.evidence | Where-Object { $_ })
        [void]$list.Add($t)
      }
    }
  }
  return , $list
}

function Write-Tasks($list) {
  $lines = @($list | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 6 })
  $tmp = "$Fichier.tmp"
  [IO.File]::WriteAllLines($tmp, [string[]]$lines, $Utf8)
  Move-Item -Force $tmp $Fichier
}

function Lock-Store {
  for ($i = 0; $i -lt 50; $i++) {
    try { return [IO.File]::Open($LockFile, 'CreateNew', 'Write', 'None') } catch { Start-Sleep -Milliseconds 100 }
  }
  Fail "store locked ($LockFile). If no other command runs, delete that file."
}
function Unlock-Store($h) { $h.Close(); Remove-Item -Force $LockFile -ErrorAction SilentlyContinue }

function Find-Task($list, [string]$taskId) {
  $t = $list | Where-Object { $_.id -eq $taskId } | Select-Object -First 1
  if (-not $t) { Fail "unknown task $taskId" }
  return $t
}

function Split-Zone([string]$z) {
  if (-not $z) { return @() }
  return @($z -split ';' | ForEach-Object { ($_.Trim() -replace '\\', '/').TrimEnd('/').ToLowerInvariant() } | Where-Object { $_ })
}
function Test-Overlap([string]$a, [string]$b) {
  foreach ($x in (Split-Zone $a)) { foreach ($y in (Split-Zone $b)) {
      if ($x -eq $y -or $x.StartsWith("$y/") -or $y.StartsWith("$x/")) { return $true }
    } }
  return $false
}
function Test-LeaseLive($t) {
  if (-not $t.lease_until) { return $false }
  return ([DateTime]::Parse($t.lease_until).ToUniversalTime() -gt (Get-Date).ToUniversalTime())
}
function Test-DepsDone($list, $t) {
  foreach ($d in $t.deps) {
    $dt = $list | Where-Object { $_.id -eq $d } | Select-Object -First 1
    if (-not $dt -or $Finished -notcontains $dt.state) { return $false }
  }
  return $true
}

function Show-Table($rows) {
  $rows | Select-Object id, state, owner, machine,
  @{n = 'deps'; e = { $_.deps -join ',' } }, area,
  @{n = 'lease'; e = { if (Test-LeaseLive $_) { $_.lease_until } else { '' } } }, title |
  Format-Table -AutoSize -Wrap | Out-String -Width 220
}

function Add-Evidence($t, [string]$state, [string]$proof, [string]$by) {
  $t.evidence = @($t.evidence) + @([pscustomobject]@{ state = $state; proof = $proof; by = $by; at = (Get-Now) })
}

switch ($Commande) {
  'list' {
    $l = Read-Tasks
    $rows = if ($Etat) { $l | Where-Object { $_.state -eq $Etat } } else { $l }
    if (Test-Path $StopFile) { Write-Output "EMERGENCY STOP active: $([IO.File]::ReadAllText($StopFile, $Utf8).Trim())" }
    Show-Table $rows
  }
  'ready' {
    $l = Read-Tasks
    Show-Table ($l | Where-Object { $_.state -eq 'todo' -and (Test-DepsDone $l $_) })
  }
  'show' {
    if (-not $Id) { Fail '-Id required' }
    (Find-Task (Read-Tasks) $Id) | ConvertTo-Json -Depth 6
  }
  'zones' {
    Show-Table ((Read-Tasks) | Where-Object { $Active -contains $_.state -and $_.area -and (Test-LeaseLive $_) })
  }
  'stop' {
    [IO.File]::WriteAllText($StopFile, "$(Get-Now) $Note", $Utf8)
    Write-Output "Emergency stop on for $Projet. Running tasks continue; no new claim."
  }
  'start' {
    Remove-Item -Force $StopFile -ErrorAction SilentlyContinue
    Write-Output "Emergency stop lifted for $Projet."
  }
  default {
    $h = Lock-Store
    try {
      $l = Read-Tasks
      switch ($Commande) {
        'add' {
          if (-not $Titre) { Fail '-Titre required' }
          $max = 0
          foreach ($t in $l) { if ($t.id -match "^$([regex]::Escape($Projet))-(\d+)$") { $n = [int]$Matches[1]; if ($n -gt $max) { $max = $n } } }
          $deps = @($Deps | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
          foreach ($d in $deps) { [void](Find-Task $l $d) }
          $new = [pscustomobject]@{
            id = "$Projet-$($max + 1)"; title = $Titre; state = 'todo'; deps = $deps; area = $Zone; owner = ''; machine = '';
            branch = ''; lease_until = ''; note = $Note; evidence = @(); created = (Get-Now); updated = (Get-Now)
          }
          [void]$l.Add($new); Write-Tasks $l; Write-Output $new.id
        }
        'claim' {
          if (-not $Id -or -not $Par) { Fail '-Id and -Par required' }
          if (Test-Path $StopFile) { Fail "emergency stop active, no new claim ($([IO.File]::ReadAllText($StopFile, $Utf8).Trim()))" }
          $t = Find-Task $l $Id
          if ($t.state -ne 'todo') { Fail "$Id is $($t.state), not todo" }
          if (-not (Test-DepsDone $l $t)) { Fail "$Id waits on $($t.deps -join ',')" }
          if ($Zone) { $t.area = $Zone }
          foreach ($o in $l) {
            if ($o.id -ne $t.id -and $Active -contains $o.state -and (Test-LeaseLive $o) -and (Test-Overlap $o.area $t.area)) {
              Fail "area '$($t.area)' overlaps $($o.id) held by $($o.owner) until $($o.lease_until)"
            }
          }
          $t.state = 'doing'; $t.owner = $Par; if ($Machine) { $t.machine = $Machine }
          $t.lease_until = (Get-Date).ToUniversalTime().AddHours($Heures).ToString('yyyy-MM-ddTHH:mm:ssZ'); $t.updated = (Get-Now)
          Add-Evidence $t 'doing' "claimed area '$($t.area)'" $Par
          Write-Tasks $l; Write-Output "$Id claimed by $Par until $($t.lease_until)"
        }
        'set' {
          if (-not $Id -or -not $Etat) { Fail '-Id and -Etat required' }
          if ($States -notcontains $Etat) { Fail "unknown state $Etat (use: $($States -join ', '))" }
          $t = Find-Task $l $Id
          $needsProof = ($States.IndexOf($Etat) -gt $States.IndexOf('doing') -and $Etat -ne 'dropped') -or $Etat -eq 'blocked'
          if ($needsProof -and -not $Preuve) { Fail "state $Etat needs -Preuve (command + exit code, review verdict, commit sha, URL + HTTP code)" }
          $t.state = $Etat; $t.updated = (Get-Now)
          if ($Branche) { $t.branch = $Branche }
          if ($Finished -contains $Etat) { $t.lease_until = '' }
          $by = if ($Par) { $Par } else { $t.owner }
          Add-Evidence $t $Etat $(if ($Preuve) { $Preuve } else { $Note }) $by
          Write-Tasks $l; Write-Output "$Id -> $Etat"
        }
        'renew' {
          $t = Find-Task $l $Id
          if ($Active -notcontains $t.state) { Fail "$Id is $($t.state), nothing to renew" }
          $t.lease_until = (Get-Date).ToUniversalTime().AddHours($Heures).ToString('yyyy-MM-ddTHH:mm:ssZ'); $t.updated = (Get-Now)
          Write-Tasks $l; Write-Output "$Id reserved until $($t.lease_until)"
        }
        'release' {
          $t = Find-Task $l $Id
          Add-Evidence $t 'todo' "released: $Note" $t.owner
          $t.state = 'todo'; $t.owner = ''; $t.lease_until = ''; $t.updated = (Get-Now)
          Write-Tasks $l; Write-Output "$Id released"
        }
      }
    }
    finally { Unlock-Store $h }
  }
}
