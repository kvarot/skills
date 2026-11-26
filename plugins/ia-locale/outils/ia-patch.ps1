# ia-patch.ps1 — a code change by a LOCAL model in ONE model call, without an agent loop.
# An agent harness costs thousands of tokens before it reads the task and re-sends them at every
# step; on a machine without a fast GPU that is minutes per step. Here the script does the tool
# work itself (reads the files, applies the edits, runs the check) and the model is called once:
# files in, exact SEARCH/REPLACE edits out. Use it for a narrow change in known files.
#
#   ia-patch.ps1 -Repo <dir> (-Task "<text>" | -BriefFile <file>) -Files a.php,b.php
#                [-ReadOnly tests/ATest.php] [-AllowNew] [-Model <name>] [-MaxTokens 3000]
#                [-Check "<command>"] [-Attempts 2] [-Quiet]
#
#   -Files     files the model may edit (given in full)
#   -ReadOnly  files given as reference only (tests to satisfy, an interface): never edited
#   -AllowNew  let the model create new files
#   -Check     command run in <dir> after the edits; a failure is sent back for one more attempt
#   -Reasoning low|medium|high   reasoning effort, for models whose chat template accepts it
#
# Edits are applied only when the SEARCH text matches exactly once. Nothing is committed. It edits
# <dir> in place: point it at a worktree. Result as JSON; log in $AI_ROOT\logs\ask.jsonl.
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Task = '', [string]$BriefFile = '',
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string[]]$ReadOnly = @(), [switch]$AllowNew,
  [string]$Model = '', [int]$MaxTokens = 3000, [int]$MaxInputChars = 60000,
  [string]$Check = '', [int]$Attempts = 2, [switch]$Quiet,
  [ValidateSet('', 'low', 'medium', 'high')][string]$Reasoning = ''
)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
if (-not $Task -and -not $BriefFile) { throw 'Give -Task or -BriefFile.' }
if ($BriefFile) { $Task = [IO.File]::ReadAllText((Resolve-Path $BriefFile).Path) }
$dir = (Resolve-Path $Repo).Path
$engine = [pscustomobject]@{ base_url = 'http://127.0.0.1:11434'; api_key_file = $null; models = $null }
$ef = Join-Path $root 'config\moteur.json'; if (Test-Path $ef) { $engine = Get-Content $ef -Raw -Encoding utf8 | ConvertFrom-Json }
$u = [uri]$engine.base_url; if ($u.Host -notin '127.0.0.1', 'localhost', '::1', '[::1]') { throw "Refused: engine base_url is not local ($($u.Host))." }
if (-not $Model) { $Model = if ($engine.models -and $engine.models.coding) { $engine.models.coding } else { throw 'No -Model given and no models.coding in moteur.json.' } }
$Model = ($Model -split '/')[-1]
$headers = @{}; if ($engine.api_key_file -and (Test-Path $engine.api_key_file)) { $headers.Authorization = 'Bearer ' + (Get-Content $engine.api_key_file -Raw).Trim() }
$secret = '(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.pfx|.*\.p12|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials(\..*)?|secrets?(\..*)?)$'
$norm = { param($p) $p.Replace('\', '/').TrimStart('./') }
$editable = @($Files | ForEach-Object { & $norm $_ }); $reference = @($ReadOnly | ForEach-Object { & $norm $_ })

function Read-Given([string]$rel) {
  if ($rel -match $secret) { throw "Refused: '$rel' looks like a secret file." }
  $full = Join-Path $dir $rel; if (-not (Test-Path $full -PathType Leaf)) { throw "File not found: $rel" }
  & git -C $dir check-ignore -q -- $rel 2>$null; if ($LASTEXITCODE -eq 0) { throw "Refused: '$rel' is ignored by git (local-only data)." }
  [IO.File]::ReadAllText($full)
}
$material = New-Object System.Collections.Generic.List[string]
foreach ($f in $editable) { $material.Add("=== FILE (you may edit): $f ===`n" + (Read-Given $f)) }
foreach ($f in $reference) { $material.Add("=== FILE (read only): $f ===`n" + (Read-Given $f)) }
$given = $material -join "`n`n"
if ($given.Length -gt $MaxInputChars) { throw ("Refused: {0:N0} characters of files, limit {1:N0}. Nothing is cut silently: give fewer or smaller files, or use an agent session." -f $given.Length, $MaxInputChars) }

$system = @'
You change code by returning edit blocks. Output ONLY edit blocks, no prose, no code fences.
Format of one block:
FILE: <path exactly as given>
<<<<<<< SEARCH
<lines copied EXACTLY from the file, enough of them to be unique>
=======
<the new lines>
>>>>>>> REPLACE
Rules: SEARCH must match the file character for character and occur once. Keep each block small: only the lines that change plus one or two lines around them. Several blocks are allowed. To create a new file, use an empty SEARCH part. Never edit a file marked read only. Make the smallest change that fulfils the task.
'@
function Invoke-Model($messages) {
  $req = @{ model = $Model; max_tokens = $MaxTokens; stream = $false; temperature = 0.2; messages = $messages }
  if ($Reasoning) { $req.chat_template_kwargs = @{ reasoning_effort = $Reasoning } }
  $body = $req | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri "$($engine.base_url.TrimEnd('/'))/v1/chat/completions" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 3600
}
function Apply-Edits([string]$answer) {
  $done = New-Object System.Collections.Generic.List[string]; $errors = New-Object System.Collections.Generic.List[string]
  $rx = [regex]'(?ms)^FILE:\s*(?<f>[^\r\n]+?)\s*\r?\n<{5,}\s*SEARCH\r?\n(?<s>.*?)(?:\r?\n)?={5,}\r?\n(?<r>.*?)(?:\r?\n)?>{5,}\s*REPLACE'
  $blocks = $rx.Matches($answer); if (-not $blocks.Count) { $errors.Add('no edit block found in the answer'); return @{ done = $done; errors = $errors } }
  foreach ($b in $blocks) {
    $rel = & $norm $b.Groups['f'].Value.Trim('`', '"', "'", ' '); $search = $b.Groups['s'].Value; $repl = $b.Groups['r'].Value
    $full = Join-Path $dir $rel; $isNew = -not (Test-Path $full)
    if ($rel -match $secret -or $rel -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($rel)) { $errors.Add("$rel : path refused"); continue }
    if ($reference -contains $rel) { $errors.Add("$rel : read-only file, edit refused"); continue }
    if ($isNew) {
      if (-not $AllowNew) { $errors.Add("$rel : new file not allowed"); continue }
      if ($search.Trim()) { $errors.Add("$rel : file does not exist but SEARCH is not empty"); continue }
      New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null; [IO.File]::WriteAllText($full, ($repl + "`n"), (New-Object Text.UTF8Encoding($false))); $done.Add($rel); continue
    }
    if ($editable -notcontains $rel) { $errors.Add("$rel : not in the list of editable files"); continue }
    $bytes = [IO.File]::ReadAllBytes($full); $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $text = [IO.File]::ReadAllText($full); $crlf = $text.Contains("`r`n")
    $t = $text.Replace("`r`n", "`n"); $s = $search.Replace("`r`n", "`n"); $r = $repl.Replace("`r`n", "`n")
    if (-not $s.Trim()) { $errors.Add("$rel : empty SEARCH on an existing file"); continue }
    if ($s -ceq $r) { $errors.Add("$rel : REPLACE is identical to SEARCH, nothing would change"); continue }
    $first = $t.IndexOf($s); if ($first -lt 0) { $errors.Add("$rel : SEARCH text not found (must be copied exactly)"); continue }
    if ($t.IndexOf($s, $first + 1) -ge 0) { $errors.Add("$rel : SEARCH text occurs more than once (add lines to make it unique)"); continue }
    $t = $t.Substring(0, $first) + $r + $t.Substring($first + $s.Length); if ($crlf) { $t = $t.Replace("`n", "`r`n") }
    [IO.File]::WriteAllText($full, $t, (New-Object Text.UTF8Encoding($bom))); if ($done -notcontains $rel) { $done.Add($rel) }
  }
  return @{ done = $done; errors = $errors }
}

$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$logDir = Join-Path $root 'logs\ask'; New-Item -ItemType Directory -Force $logDir | Out-Null
$messages = @(@{ role = 'system'; content = $system }, @{ role = 'user'; content = "Task:`n$Task`n`n$given" })
$t0 = Get-Date; $status = 'no_edit'; $changed = @(); $pIn = 0; $pOut = 0; $attempt = 0; $notes = @(); $checkCode = $null
while ($attempt -lt $Attempts) {
  $attempt++
  try { $r = Invoke-Model $messages } catch { $status = 'error'; $notes += "model call failed: $($_.Exception.Message)"; break }
  $pIn += [int]$r.usage.prompt_tokens; $pOut += [int]$r.usage.completion_tokens
  $answer = "$($r.choices[0].message.content)"; [IO.File]::WriteAllText((Join-Path $logDir "$id-attempt$attempt.md"), $answer, (New-Object Text.UTF8Encoding($false)))
  if ($r.choices[0].finish_reason -eq 'length') { $notes += "attempt ${attempt}: answer cut at $MaxTokens tokens" }
  $res = Apply-Edits $answer; $changed = @($changed + $res.done | Select-Object -Unique)
  $feedback = @()
  if ($res.errors.Count) { $status = $(if ($res.done.Count) { 'partial' } else { 'apply_failed' }); $notes += $res.errors; $feedback += 'These edits could not be applied: ' + ($res.errors -join ' ; ') }
  elseif ($res.done.Count) { $status = 'applied' }
  if ($Check -and $res.done.Count -and -not $res.errors.Count) {
    $out = Join-Path $logDir "$id-check$attempt.log"
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', "($Check) > `"$out`" 2>&1" -WorkingDirectory $dir -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit(900000)) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null; $checkCode = 124 } else { $checkCode = $p.ExitCode }
    if ($checkCode -eq 0) { $status = 'check_passed'; break }
    $status = 'check_failed'; $tail = (Get-Content $out -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
    $feedback += "The check command failed (exit $checkCode). End of its output:`n$tail"
  }
  if (-not $feedback.Count) { break }
  # Next attempt: the files as they are now, plus what went wrong. No conversation history to re-read.
  $now = New-Object System.Collections.Generic.List[string]
  foreach ($f in $editable) { $now.Add("=== FILE (you may edit): $f ===`n" + [IO.File]::ReadAllText((Join-Path $dir $f))) }
  foreach ($f in $reference) { $now.Add("=== FILE (read only): $f ===`n" + [IO.File]::ReadAllText((Join-Path $dir $f))) }
  $messages = @(@{ role = 'system'; content = $system }, @{ role = 'user'; content = "Task:`n$Task`n`nA previous attempt was made. " + ($feedback -join "`n") + "`n`nCurrent state of the files:`n`n" + ($now -join "`n`n") })
}
$result = [ordered]@{ id = $id; status = $status; model = $Model; attempts = $attempt; files_changed = @($changed); check_exit = $checkCode
  prompt_tokens = $pIn; completion_tokens = $pOut; seconds = [int]((Get-Date) - $t0).TotalSeconds; notes = @($notes | Select-Object -First 8); answers = (Join-Path $logDir "$id-attempt*.md") }
(([ordered]@{ id = $id; at = $t0.ToUniversalTime().ToString('o'); seconds = $result.seconds; status = $status; model = $Model; kind = 'patch'; files = $editable.Count + $reference.Count; input_chars = $given.Length; prompt_tokens = $pIn; completion_tokens = $pOut }) | ConvertTo-Json -Compress) | Add-Content -Path (Join-Path $root 'logs\ask.jsonl') -Encoding utf8
if ($Quiet) { Write-Output ("{0} | {1} file(s) | {2} attempt(s) | {3} tokens in, {4} out | {5}s" -f $status, @($changed).Count, $attempt, $pIn, $pOut, $result.seconds) } else { $result | ConvertTo-Json -Depth 4 }
if ($status -in 'applied', 'check_passed') { exit 0 } else { exit 1 }
