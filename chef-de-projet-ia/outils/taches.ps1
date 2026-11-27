<#
.SYNOPSIS
  Task register for AI-agent orchestration: one JSONL file per project. The register enforces
  the rules it can check itself: order of states, form and freshness of proofs, who may validate,
  reservations, work-in-progress limits, loop limits, emergency stop.

.DESCRIPTION
  Store: <orchestration>\projets\<PREFIX>\taches.jsonl (one JSON object per line), or -Fichier.
  Commands:
    list   [-Etat <state>]                     all tasks (or one state)
    ready                                      todo tasks whose dependencies are finished
    show   -Id PRJ-1 [-Repo <path>]            one task with its evidence (-Repo: compares the branch head with the proofs)
    add    -Titre "..." [-Deps PRJ-1,PRJ-2] [-Zone "internal/x;web/src/y"] [-Note "..."]
    claim  -Id PRJ-1 -Par <session> [-Machine <m>] [-Zone "..."] [-Heures 4] [-Base <sha>] [-Repo <path>]
    set    -Id PRJ-1 -Etat <state> -Preuve "<proof>" [-Par <who>] [-Branche <b>] [-Forcer -Note "why"]
    renew  -Id PRJ-1 [-Heures 4] [-Par <new session>]   extend the reservation; -Par takes over an expired one
    release -Id PRJ-1 [-Note "why"]            give back work in progress (todo, no owner)
    zones                                      live area reservations
    stale                                      work in progress whose reservation expired (worker gone?)
    stop   [-Note "why"] / start               emergency stop: no claim, no takeover, no merged/deployed

  States: todo, doing, implemented, tests_run, tests_green, reviewed, accepted, merged, deployed, blocked, dropped.

  Order (set refuses anything else unless -Forcer -Note "<reason>", which is recorded):
    doing -> implemented -> tests_run -> tests_green -> reviewed -> accepted -> merged -> deployed
    a new commit goes back to implemented from tests_run, tests_green, reviewed or accepted
    blocked from todo or any state in progress; a blocked task resumes at the state it had
    dropped from any unfinished state; todo and doing come from release and claim only

  Proof forms (-Preuve):
    implemented  the commit sha
    tests_run    "<command> exit <code> @ <sha>"            sha = the last implemented commit
    tests_green  "<command> exit 0 [; <command> exit 0] @ <sha>"   every suite at exit 0
    reviewed     "MERGEABLE @ <sha>" with -Par <reviewer>, who is not the task's worker
    accepted     "<gate command> exit 0", or the owner's acceptance ("accepted by the owner, ...")
    merged       the sha on the base branch
    deployed     "<url> <HTTP code>" or the version shown
    blocked      what blocks and who must act
  reviewed, accepted, merged and deployed need -Par, and never the task's own worker.

  Limits: one task in progress per worker; per machine, 6 tasks unless <store folder>\limites.json says
  otherwise ({ "defaut": 6, "machines": { "runner": 2 } }); 3 fix attempts (tests_run -> implemented)
  and 2 returns from review (tests_green|reviewed -> implemented), then the task must be set blocked.

  Windows PowerShell 5.1 compatible. No network. Git is called only when -Repo is given.
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('list', 'ready', 'show', 'add', 'claim', 'set', 'renew', 'release', 'zones', 'stale', 'stop', 'start')]
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
  [string]$Base,
  [string]$Repo,
  [double]$Heures = 4,
  [switch]$Forcer
)

$ErrorActionPreference = 'Stop'
$States = 'todo', 'doing', 'implemented', 'tests_run', 'tests_green', 'reviewed', 'accepted', 'merged', 'deployed', 'blocked', 'dropped'
$Finished = 'merged', 'deployed', 'dropped'
$Active = 'doing', 'implemented', 'tests_run', 'tests_green', 'reviewed', 'accepted'
$Holding = $Active + 'blocked'
$Next = @{
  doing       = @('implemented')
  implemented = @('implemented', 'tests_run')
  tests_run   = @('tests_run', 'tests_green', 'implemented')
  tests_green = @('reviewed', 'implemented')
  reviewed    = @('accepted', 'implemented')
  accepted    = @('merged', 'implemented')
  merged      = @('deployed')
}
$ByOthers = 'reviewed', 'accepted', 'merged', 'deployed'
$OnLastCommit = 'tests_run', 'tests_green', 'reviewed'
$MaxFixAttempts = 3
$MaxReviewReturns = 2
$DefaultWip = 6

if (-not $Fichier) { $Fichier = Join-Path (Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'projets') $Projet) 'taches.jsonl' }
$Dir = Split-Path $Fichier -Parent
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Force $Dir | Out-Null }
$StopFile = Join-Path $Dir 'STOP'
$LimitsFile = Join-Path $Dir 'limites.json'
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

# Tasks written by an earlier version of this script lack the newer fields.
function Get-Field($t, [string]$name, $default) {
  $p = $t.PSObject.Properties[$name]
  if ($p -and $null -ne $p.Value) { return $p.Value }
  return $default
}
function Set-Field($t, [string]$name, $value) {
  if ($t.PSObject.Properties[$name]) { $t.$name = $value } else { $t | Add-Member -NotePropertyName $name -NotePropertyValue $value }
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
function Get-Lease([double]$hours) { (Get-Date).ToUniversalTime().AddHours($hours).ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Test-DepsDone($list, $t) {
  foreach ($d in $t.deps) {
    $dt = $list | Where-Object { $_.id -eq $d } | Select-Object -First 1
    if (-not $dt -or $Finished -notcontains $dt.state) { return $false }
  }
  return $true
}
function Get-StopNote { [IO.File]::ReadAllText($StopFile, $Utf8).Trim() }

# --- proofs -----------------------------------------------------------------

$ShaRx = '(?i)\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b'
$ExitRx = '(?i)\bexit(?:\s+code)?\s*[:=]?\s*(-?\d+)'

function Get-Sha([string]$s) {
  $m = [regex]::Match("$s", $ShaRx)
  if ($m.Success) { return $m.Value.ToLowerInvariant() }
  return ''
}
function Get-AtSha([string]$s) {
  $m = [regex]::Match("$s", '(?i)@\s*([0-9a-f]{7,40})\b')
  if ($m.Success) { return $m.Groups[1].Value.ToLowerInvariant() }
  return ''
}
function Test-SameSha([string]$a, [string]$b) { return ($a.StartsWith($b) -or $b.StartsWith($a)) }
function Get-ImplSha($t) {
  $last = @($t.evidence | Where-Object { $_.state -eq 'implemented' }) | Select-Object -Last 1
  if ($last) { return (Get-Sha $last.proof) }
  return ''
}
function Get-ExitCodes([string]$s) { return @([regex]::Matches("$s", $ExitRx) | ForEach-Object { [int]$_.Groups[1].Value }) }
function Test-AllZero($codes) { return ($codes.Count -gt 0 -and @($codes | Where-Object { $_ -ne 0 }).Count -eq 0) }

# Returns '' when the proof has the form the state needs, else what is missing.
function Test-Proof([string]$state, [string]$p) {
  if ($p -match '^\s*(ok|okay|done|fait|works?|it works|works as expected|.a marche|tbd|todo|fixed|verified|passing|green)\s*[.!]*\s*$') {
    return "'$p' is not a proof: give what was run or observed"
  }
  switch ($state) {
    'implemented' { if (-not (Get-Sha $p)) { return 'implemented needs the commit sha' } }
    'tests_run' { if ((Get-ExitCodes $p).Count -eq 0) { return "tests_run needs the suite command and its exit code ('<command> exit <code> @ <sha>')" } }
    'tests_green' { if (-not (Test-AllZero (Get-ExitCodes $p))) { return "tests_green needs every suite at exit 0 ('<command> exit 0 ; <command> exit 0 @ <sha>')" } }
    'reviewed' { if ($p -notmatch '(?<!\b(?:not|non)[\s-]+)\bMERGEABLE\b') { return "reviewed needs the verdict MERGEABLE ('MERGEABLE @ <sha>'); another verdict sends the task back to implemented" } }
    'accepted' { if (-not (Test-AllZero (Get-ExitCodes $p)) -and $p -notmatch '\b(owner|propri.taire)\b') { return "accepted needs the gate command at exit 0, or the owner's acceptance ('accepted by the owner, ...')" } }
    'merged' { if (-not (Get-Sha $p)) { return 'merged needs the commit sha on the base branch' } }
    'deployed' {
      $url = ($p -match 'https?://\S+') -and ($p -match '\b[1-5]\d\d\b')
      if (-not $url -and $p -notmatch '\bv(ersion)?\s*\d+(\.\d+)+') { return 'deployed needs URL + HTTP code, or the version shown' }
    }
  }
  if ($OnLastCommit -contains $state -and -not (Get-AtSha $p)) { return "$state needs the commit it was run on: end the proof with '@ <sha>'" }
  return ''
}

# --- limits -----------------------------------------------------------------

function Get-MachineLimit([string]$machine) {
  $limit = $DefaultWip
  if (Test-Path $LimitsFile) {
    $cfg = [IO.File]::ReadAllText($LimitsFile, $Utf8) | ConvertFrom-Json
    if ($cfg.PSObject.Properties['defaut']) { $limit = [int]$cfg.defaut }
    if ($cfg.PSObject.Properties['machines'] -and $cfg.machines) {
      $p = $cfg.machines.PSObject.Properties | Where-Object { $_.Name -eq $machine } | Select-Object -First 1
      if ($p) { $limit = [int]$p.Value }
    }
  }
  return $limit
}
function Assert-Wip($list, $t, [string]$who, [string]$machine) {
  $running = @($list | Where-Object { $_.id -ne $t.id -and $Active -contains $_.state -and (Test-LeaseLive $_) })
  $mine = $running | Where-Object { $_.owner -eq $who } | Select-Object -First 1
  if ($mine) { Fail "$who already holds $($mine.id) ($($mine.state)): one task per worker" }
  if ($machine) {
    $limit = Get-MachineLimit $machine
    $n = @($running | Where-Object { $_.machine -eq $machine }).Count
    if ($n -ge $limit) { Fail "$machine already runs $n task(s), limit ${limit}: queue, do not start more" }
  }
}
function Assert-AreaFree($list, $t) {
  foreach ($o in $list) {
    if ($o.id -ne $t.id -and $Holding -contains $o.state -and (Test-LeaseLive $o) -and (Test-Overlap $o.area $t.area)) {
      Fail "area '$($t.area)' overlaps $($o.id) ($($o.state)) held by $($o.owner) until $($o.lease_until)"
    }
  }
}

# --- output -----------------------------------------------------------------

function Show-Table($rows) {
  $rows | Select-Object id, state, owner, machine,
  @{n = 'deps'; e = { $_.deps -join ',' } }, area,
  @{n = 'lease'; e = { if (Test-LeaseLive $_) { $_.lease_until } elseif ($Holding -contains $_.state) { 'expired' } else { '' } } }, title |
  Format-Table -AutoSize -Wrap | Out-String -Width 220
}

function Add-Evidence($t, [string]$state, [string]$proof, [string]$by, $extra) {
  $e = [ordered]@{ state = $state; proof = $proof; by = $by; at = (Get-Now) }
  if ($extra) { foreach ($k in $extra.Keys) { $e[$k] = $extra[$k] } }
  $t.evidence = @($t.evidence) + @([pscustomobject]$e)
}

function Get-BlockedFrom($t) {
  $from = Get-Field $t 'blocked_from' ''
  if ($from) { return $from }
  $before = @($t.evidence | Where-Object { $_.state -ne 'blocked' }) | Select-Object -Last 1
  if ($before -and $States -contains $before.state) { return $before.state }
  return ''
}

switch ($Commande) {
  'list' {
    $l = Read-Tasks
    $rows = if ($Etat) { $l | Where-Object { $_.state -eq $Etat } } else { $l }
    if (Test-Path $StopFile) { Write-Output "EMERGENCY STOP active: $(Get-StopNote)" }
    Show-Table $rows
  }
  'ready' {
    $l = Read-Tasks
    Show-Table ($l | Where-Object { $_.state -eq 'todo' -and (Test-DepsDone $l $_) })
  }
  'show' {
    if (-not $Id) { Fail '-Id required' }
    $t = Find-Task (Read-Tasks) $Id
    if ($Repo) {
      $impl = Get-ImplSha $t
      $ref = if ($t.branch) { $t.branch } else { 'HEAD' }
      $head = "$(& git -C $Repo rev-parse --verify --quiet "$ref^{commit}")".Trim().ToLowerInvariant()
      if (-not $head) { Fail "cannot read '$ref' in $Repo" }
      $stale = [bool]($impl -and -not (Test-SameSha $head $impl))
      $check = [ordered]@{ ref = $ref; head = $head; implemented = $impl; stale = $stale }
      if ($stale) { $check['warning'] = "$ref moved since the last implemented proof: test and review proofs no longer cover it" }
      Set-Field $t 'check' ([pscustomobject]$check)
    }
    $t | ConvertTo-Json -Depth 6
  }
  'zones' {
    Show-Table ((Read-Tasks) | Where-Object { $Holding -contains $_.state -and $_.area -and (Test-LeaseLive $_) })
  }
  'stale' {
    Show-Table ((Read-Tasks) | Where-Object { $Holding -contains $_.state -and -not (Test-LeaseLive $_) })
  }
  'stop' {
    [IO.File]::WriteAllText($StopFile, "$(Get-Now) $Note", $Utf8)
    Write-Output "Emergency stop on for $Projet. Running tasks continue; no new claim, no merge, no deploy."
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
            branch = ''; base_sha = ''; lease_until = ''; note = $Note; blocked_from = ''; fix_attempts = 0; review_returns = 0;
            evidence = @(); created = (Get-Now); updated = (Get-Now)
          }
          [void]$l.Add($new); Write-Tasks $l; Write-Output $new.id
        }
        'claim' {
          if (-not $Id -or -not $Par) { Fail '-Id and -Par required' }
          if (Test-Path $StopFile) { Fail "emergency stop active, no new claim ($(Get-StopNote))" }
          $t = Find-Task $l $Id
          if ($t.state -ne 'todo') { Fail "$Id is $($t.state), not todo" }
          if (-not (Test-DepsDone $l $t)) { Fail "$Id waits on $($t.deps -join ',')" }
          $baseSha = ''
          if ($Base) {
            if ($Repo) {
              $baseSha = "$(& git -C $Repo rev-parse --verify --quiet "$Base^{commit}")".Trim().ToLowerInvariant()
              if (-not $baseSha) { Fail "-Base '$Base' is not a commit of $Repo" }
            }
            elseif ($Base -match '^[0-9a-fA-F]{7,40}$') { $baseSha = $Base.ToLowerInvariant() }
            else { Fail "-Base must be a commit sha (or add -Repo <path> to resolve '$Base')" }
          }
          if ($Zone) { $t.area = $Zone }
          Assert-Wip $l $t $Par $Machine
          Assert-AreaFree $l $t
          $t.state = 'doing'; $t.owner = $Par; if ($Machine) { $t.machine = $Machine }
          Set-Field $t 'base_sha' $baseSha
          Set-Field $t 'blocked_from' ''; Set-Field $t 'fix_attempts' 0; Set-Field $t 'review_returns' 0
          $t.lease_until = Get-Lease $Heures; $t.updated = (Get-Now)
          Add-Evidence $t 'doing' "claimed area '$($t.area)'$(if ($baseSha) { " from base $baseSha" })" $Par $null
          Write-Tasks $l
          Write-Output "$Id claimed by $Par until $($t.lease_until)"
          if (-not $baseSha) { Write-Output "note: no -Base recorded; the review range will have to be given by hand" }
        }
        'set' {
          if (-not $Id -or -not $Etat) { Fail '-Id and -Etat required' }
          if ($States -notcontains $Etat) { Fail "unknown state $Etat (use: $($States -join ', '))" }
          $t = Find-Task $l $Id
          $from = $t.state
          $resume = ($from -eq 'blocked' -and $Etat -ne 'dropped' -and $Etat -eq (Get-BlockedFrom $t))
          if (-not $resume) {
            if ($Etat -eq 'doing') { Fail 'doing is reached by a claim: use claim' }
            if ($Etat -eq 'todo') { Fail 'todo is reached by giving the task back: use release' }
          }

          # 1. Order of states.
          $allowed = @()
          if ($from -eq 'blocked') { $allowed = @((Get-BlockedFrom $t), 'dropped') | Where-Object { $_ } }
          elseif ($Finished -notcontains $from) {
            if ($Next.ContainsKey($from)) { $allowed += $Next[$from] }
            $allowed += 'blocked', 'dropped'
          }
          elseif ($Next.ContainsKey($from)) { $allowed += $Next[$from] }
          $forced = $false
          if ($allowed -notcontains $Etat) {
            if (-not $Forcer) { Fail "transition $from -> $Etat is not allowed (from $from`: $(if ($allowed) { $allowed -join ', ' } else { 'nothing' })). To record an exception: -Forcer -Note `"<reason>`"" }
            if (-not $Note) { Fail '-Forcer needs -Note "<reason>": the exception is recorded with it' }
            $forced = $true
          }

          # 2. Emergency stop. Not lifted by -Forcer: only the owner's "start" lifts it.
          if (($Etat -eq 'merged' -or $Etat -eq 'deployed') -and (Test-Path $StopFile)) { Fail "emergency stop active, no $Etat ($(Get-StopNote))" }

          # 3. A proof, in the form the state needs, on the last implemented commit.
          $sha = ''
          if ($Etat -eq 'dropped') {
            if (-not $Preuve -and -not $Note) { Fail 'dropped needs a reason (-Note or -Preuve)' }
          }
          else {
            if (-not $Preuve) { Fail "state $Etat needs -Preuve (see the proof forms: Get-Help $($MyInvocation.MyCommand.Name) -Full)" }
            if (-not $resume -and $Etat -ne 'blocked') {
              $missing = Test-Proof $Etat $Preuve
              if ($missing) { Fail $missing }
              if ($OnLastCommit -contains $Etat) {
                $sha = Get-AtSha $Preuve
                $impl = Get-ImplSha $t
                if ($impl -and -not (Test-SameSha $sha $impl)) { Fail "proof is on $sha but the last implemented commit is $impl`: run it again on that commit, or record the new commit with -Etat implemented first" }
              }
              elseif ($Etat -eq 'implemented' -or $Etat -eq 'merged') { $sha = Get-Sha $Preuve }
            }
          }

          # 4. Nobody validates their own work.
          $by = if ($Par) { $Par } else { $t.owner }
          if (-not $resume -and $ByOthers -contains $Etat) {
            if (-not $Par) { Fail "state $Etat needs -Par <who>: it is never recorded under the worker's name" }
            if ($t.owner -and $Par -eq $t.owner) { Fail "$Par is the worker of $Id`: nobody sets $Etat on their own work" }
          }

          # 5. Loop limits.
          $fix = [int](Get-Field $t 'fix_attempts' 0)
          $rev = [int](Get-Field $t 'review_returns' 0)
          if ($resume) { $fix = 0; $rev = 0 }
          elseif ($Etat -eq 'implemented' -and $from -eq 'tests_run') {
            if ($fix -ge $MaxFixAttempts -and -not $forced) { Fail "$MaxFixAttempts fix attempts already recorded on $Id`: set it blocked with the facts and ask the owner, or change approach" }
            $fix++
          }
          elseif ($Etat -eq 'implemented' -and ($from -eq 'tests_green' -or $from -eq 'reviewed')) {
            if ($rev -ge $MaxReviewReturns -and -not $forced) { Fail "$MaxReviewReturns review rounds already recorded on $Id`: set it blocked with the facts and ask the owner" }
            $rev++
          }
          elseif ($Etat -eq 'tests_green') { $fix = 0 }

          Set-Field $t 'fix_attempts' $fix
          Set-Field $t 'review_returns' $rev
          Set-Field $t 'blocked_from' $(if ($Etat -eq 'blocked') { $from } else { '' })
          $t.state = $Etat; $t.updated = (Get-Now)
          if ($Branche) { $t.branch = $Branche }
          if ($Finished -contains $Etat) { $t.lease_until = '' }
          $extra = [ordered]@{}
          if ($sha) { $extra['sha'] = $sha }
          if ($resume) { $extra['resumed'] = $true }
          if ($forced) { $extra['forced'] = $true; $extra['from'] = $from; $extra['note'] = $Note }
          Add-Evidence $t $Etat $(if ($Preuve) { $Preuve } else { $Note }) $by $extra
          Write-Tasks $l; Write-Output "$Id -> $Etat$(if ($forced) { ' (forced, recorded)' })"
        }
        'renew' {
          if (-not $Id) { Fail '-Id required' }
          $t = Find-Task $l $Id
          if ($Holding -notcontains $t.state) { Fail "$Id is $($t.state), nothing to renew" }
          if ($Par -and $Par -ne $t.owner) {
            if (Test-LeaseLive $t) { Fail "$Id is held by $($t.owner) until $($t.lease_until): ask for a release, or wait for the reservation to expire" }
            if (Test-Path $StopFile) { Fail "emergency stop active, no takeover ($(Get-StopNote))" }
            $where = if ($Machine) { $Machine } else { $t.machine }
            Assert-Wip $l $t $Par $where
            Assert-AreaFree $l $t
            Add-Evidence $t $t.state "taken over from $($t.owner)" $Par $null
            $t.owner = $Par; $t.machine = $where
          }
          $t.lease_until = Get-Lease $Heures; $t.updated = (Get-Now)
          Write-Tasks $l; Write-Output "$Id reserved by $($t.owner) until $($t.lease_until)"
        }
        'release' {
          if (-not $Id) { Fail '-Id required' }
          $t = Find-Task $l $Id
          if ($Holding -notcontains $t.state) { Fail "$Id is $($t.state), nothing to release" }
          Add-Evidence $t 'todo' "released from $($t.state): $Note" $t.owner $null
          $t.state = 'todo'; $t.owner = ''; $t.lease_until = ''; $t.updated = (Get-Now)
          Set-Field $t 'blocked_from' ''; Set-Field $t 'fix_attempts' 0; Set-Field $t 'review_returns' 0
          Write-Tasks $l; Write-Output "$Id released"
        }
      }
    }
    finally { Unlock-Store $h }
  }
}
