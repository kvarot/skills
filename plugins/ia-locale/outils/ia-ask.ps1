# ia-ask.ps1 — one question to a LOCAL model about files, without an agent loop.
# The files are read here and sent to the local engine only; the caller (a paid session, a
# script, a human) gets back a short answer or just the path of the answer file. This is what
# keeps a paid session cheap: it never loads the files into its own context.
#
#   ia-ask.ps1 -Task "<question or instruction>" [-Files a.php,b.vue] [-Stdin] [-Model <name>]
#              [-MaxTokens 1500] [-Out <file>] [-Quiet]
#
#   -Stdin   also read piped text (a diff, a log, a test output) as material
#   -Out     write the answer to this file (default: $AI_ROOT\logs\ask\<id>.md)
#   -Quiet   print only the answer file path and the token counts, not the answer
#
# Engine: $AI_ROOT\config\moteur.json (OpenAI-compatible /v1/chat/completions: llama-server,
# Ollama, ...). Loopback only: a non-local base_url is refused. Logs to $AI_ROOT\logs\ask.jsonl.
param(
  [Parameter(Mandatory = $true)][string]$Task,
  [string[]]$Files = @(),
  [switch]$Stdin,
  [string]$Model = '',
  [int]$MaxTokens = 1500,
  [int]$MaxInputChars = 120000,
  [string]$Out = '',
  [switch]$Quiet,
  [Parameter(ValueFromPipeline = $true)][string[]]$Pipe
)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$engine = [pscustomobject]@{ type = 'ollama'; base_url = 'http://127.0.0.1:11434'; api_key_file = $null; models = $null }
$ef = Join-Path $root 'config\moteur.json'
if (Test-Path $ef) { $engine = Get-Content $ef -Raw -Encoding utf8 | ConvertFrom-Json }
$u = [uri]$engine.base_url
if ($u.Host -notin '127.0.0.1', 'localhost', '::1', '[::1]') { throw "Refused: engine base_url is not local ($($u.Host))." }
if (-not $Model) { $Model = if ($engine.models -and $engine.models.small) { $engine.models.small } else { throw 'No -Model given and no models.small in moteur.json.' } }

# Files that must never be put in a prompt, whatever the engine.
$secret = '(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.pfx|.*\.p12|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials(\..*)?|secrets?(\..*)?)$'
$parts = New-Object System.Collections.Generic.List[string]
foreach ($f in $Files) {
  if ($f -match $secret) { throw "Refused: '$f' looks like a secret file." }
  if (-not (Test-Path $f -PathType Leaf)) { throw "File not found: $f" }
  $parts.Add("=== FILE: $f ===`n" + [IO.File]::ReadAllText((Resolve-Path $f).Path))
}
if ($Stdin) { $piped = @($input) -join "`n"; if ($piped) { $parts.Add("=== INPUT ===`n$piped") } }
$material = $parts -join "`n`n"
if ($material.Length -gt $MaxInputChars) {
  throw ("Refused: {0:N0} characters of material, limit {1:N0}. Nothing is cut silently: give fewer files or raise -MaxInputChars." -f $material.Length, $MaxInputChars)
}

$body = @{
  model = $Model; max_tokens = $MaxTokens; stream = $false
  messages = @(
    @{ role = 'system'; content = 'You are a precise software engineering assistant. Answer only from the material given. If the material is not enough, say exactly what is missing. Be short. Cite file names and line contents you rely on.' },
    @{ role = 'user'; content = $(if ($material) { "$Task`n`n$material" } else { $Task }) }
  )
} | ConvertTo-Json -Depth 6
$headers = @{}
if ($engine.api_key_file -and (Test-Path $engine.api_key_file)) { $headers.Authorization = 'Bearer ' + (Get-Content $engine.api_key_file -Raw).Trim() }

$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$t0 = Get-Date; $status = 'done'; $answer = ''; $r = $null
try {
  $r = Invoke-RestMethod -Uri "$($engine.base_url.TrimEnd('/'))/v1/chat/completions" -Method Post -Headers $headers `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 1800
  $answer = "$($r.choices[0].message.content)"
  if ($r.choices[0].finish_reason -eq 'length') { $status = 'truncated' }
} catch { $status = 'error'; $answer = "ERROR: $($_.Exception.Message)" }

if (-not $Out) { $dir = Join-Path $root 'logs\ask'; New-Item -ItemType Directory -Force $dir | Out-Null; $Out = Join-Path $dir "$id.md" }
[IO.File]::WriteAllText($Out, $answer, (New-Object Text.UTF8Encoding($false)))
$entry = [ordered]@{
  id = $id; at = $t0.ToUniversalTime().ToString('o'); seconds = [int]((Get-Date) - $t0).TotalSeconds; status = $status; model = $Model
  files = $Files.Count; input_chars = $material.Length
  prompt_tokens = $(if ($r) { [int]$r.usage.prompt_tokens } else { 0 }); completion_tokens = $(if ($r) { [int]$r.usage.completion_tokens } else { 0 })
}
$log = Join-Path $root 'logs\ask.jsonl'
($entry | ConvertTo-Json -Compress) | Add-Content -Path $log -Encoding utf8
if ($Quiet) { Write-Output ("{0} | {1} | {2} tokens in, {3} out | {4}" -f $status, $Out, $entry.prompt_tokens, $entry.completion_tokens, $Model) }
else {
  Write-Output $answer
  if ($status -eq 'truncated') { Write-Output "[TRUNCATED at $MaxTokens tokens — raise -MaxTokens]" }
}
if ($status -eq 'error') { exit 1 }
exit 0
