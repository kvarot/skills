# ia-usage.ps1 — what the local AI did, and what it saved.
#   ia-usage.ps1 [-Days 7] [-All]
# Sources, all local:
#   - the local agent's own sessions (`opencode stats --json`, or its session database when
#     that option does not exist in the installed version);
#   - $AI_ROOT\logs\runs.jsonl  (ia-run.ps1: delegated tasks);
#   - $AI_ROOT\logs\ask.jsonl   (ia-ask.ps1: one-shot questions).
# Engine: $AI_ROOT\config\moteur.json (see moteur.exemple.json); default = Ollama on 127.0.0.1:11434.
# Money saved is computed ONLY from the prices you wrote in $AI_ROOT\config\prix.json (official
# page, dated); without them the report shows tokens and says the amount is unknown.
param([int]$Days = 7, [switch]$All)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$launcher = Join-Path $root 'scripts\opencode-local.ps1'
$since = if ($All) { [datetime]::MinValue } else { (Get-Date).ToUniversalTime().AddDays(-$Days) }

function Read-Jsonl($path) {
  if (-not (Test-Path $path)) { return @() }
  @(Get-Content $path -Encoding utf8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { ([datetime]$_.at).ToUniversalTime() -ge $since })
}

# --- local agent sessions -------------------------------------------------------------
$agent = $null; $perModel = @()
$ErrorActionPreference = 'Continue'
try {
  $statArgs = @('stats') + @(if ($All) { '--all' } else { '--days'; "$Days" }) + @('--models', '--cost', '--json')
  $s = (& $launcher @statArgs 2>$null | Out-String) | ConvertFrom-Json
  if ($s -and $s.tokens) {
    $agent = [pscustomobject]@{ sessions = $s.sessions; input = [int64]$s.tokens.input; output = [int64]$s.tokens.output; cache = [int64]$s.tokens.cache.read }
  }
} catch { }
if (-not $agent) {
  try {
    $ms = if ($All) { 0 } else { [int64](($since - [datetime]'1970-01-01').TotalMilliseconds) }
    $q = "SELECT coalesce(model,'?') AS model, count(*) AS sessions, sum(tokens_input) AS input, sum(tokens_output) AS output, sum(tokens_cache_read) AS cache FROM session WHERE time_created >= $ms GROUP BY model"
    $parsed = (& $launcher db $q --format json 2>$null | Out-String) | ConvertFrom-Json
    $rows = @($parsed | ForEach-Object { $_ })
    if ($rows.Count) {
      $perModel = $rows
      $agent = [pscustomobject]@{
        sessions = ($rows | Measure-Object sessions -Sum).Sum; input = [int64]($rows | Measure-Object input -Sum).Sum
        output = [int64]($rows | Measure-Object output -Sum).Sum; cache = [int64]($rows | Measure-Object cache -Sum).Sum
      }
    }
  } catch { }
}
$ErrorActionPreference = 'Stop'

$runs = Read-Jsonl (Join-Path $root 'logs\runs.jsonl')
$asks = Read-Jsonl (Join-Path $root 'logs\ask.jsonl')

$period = if ($All) { 'depuis le début' } else { "$Days derniers jours" }
Write-Output "== IA locale : usage ($period) =="
$inTok = 0; $outTok = 0; $cache = 0
if ($agent) {
  $inTok = $agent.input; $outTok = $agent.output; $cache = $agent.cache
  Write-Output ("Agent local : {0} session(s) ; {1:N0} tokens en entrée, {2:N0} en sortie, {3:N0} relus du cache" -f $agent.sessions, $inTok, $outTok, $cache)
  foreach ($m in $perModel) {
    $name = "$($m.model)"; try { $j = $name | ConvertFrom-Json; if ($j.id) { $name = $j.id } elseif ($j.modelID) { $name = $j.modelID } } catch { }
    Write-Output ("  modèle {0} : {1} session(s), {2:N0} entrée, {3:N0} sortie" -f $name, $m.sessions, $m.input, $m.output)
  }
} else { Write-Output 'Statistiques de l''agent local indisponibles.' }

if ($asks.Count) {
  $aIn = [int64]($asks | Measure-Object prompt_tokens -Sum).Sum; $aOut = [int64]($asks | Measure-Object completion_tokens -Sum).Sum
  $inTok += $aIn; $outTok += $aOut
  Write-Output ("Questions directes (ia-ask) : {0} ; {1:N0} tokens en entrée, {2:N0} en sortie ; {3:N0} s au total" -f $asks.Count, $aIn, $aOut, ($asks | Measure-Object seconds -Sum).Sum)
  $asks | Group-Object model | ForEach-Object { Write-Output ("  modèle {0} : {1} question(s)" -f $_.Name, $_.Count) }
}
if ($runs.Count) {
  $ok = @($runs | Where-Object status -eq 'done').Count
  Write-Output ("Tâches déléguées (ia-run) : {0} ({1} finies, {2} hors délai ou en échec) ; durée totale {3:N0} min" -f $runs.Count, $ok, ($runs.Count - $ok), (($runs | Measure-Object seconds -Sum).Sum / 60))
  $runs | Group-Object model | ForEach-Object { Write-Output ("  modèle {0} : {1} tâche(s)" -f $_.Name, $_.Count) }
}

# --- engine state -----------------------------------------------------------------------
$engine = [pscustomobject]@{ type = 'ollama'; base_url = 'http://127.0.0.1:11434'; api_key_file = $null }
$ef = Join-Path $root 'config\moteur.json'
if (Test-Path $ef) { $engine = Get-Content $ef -Raw -Encoding utf8 | ConvertFrom-Json }
try {
  if ($engine.type -eq 'ollama') {
    $ps = (Invoke-RestMethod "$($engine.base_url)/api/ps" -TimeoutSec 3).models
    $loaded = @($ps | ForEach-Object { "{0} ({1:N1} Go en VRAM)" -f $_.name, ($_.size_vram / 1GB) })
  } else {
    $h = @{}
    if ($engine.api_key_file -and (Test-Path $engine.api_key_file)) { $h.Authorization = 'Bearer ' + (Get-Content $engine.api_key_file -Raw).Trim() }
    $md = (Invoke-RestMethod "$($engine.base_url)/v1/models" -Headers $h -TimeoutSec 3).data
    $loaded = @($md | Where-Object { $_.status.value -eq 'loaded' } | ForEach-Object { $_.id })
  }
  Write-Output ('Modèles chargés maintenant : ' + $(if ($loaded.Count) { $loaded -join ', ' } else { 'aucun' }))
} catch { Write-Output 'Moteur local injoignable (arrêté ?).' }

# --- money ------------------------------------------------------------------------------
$p = $null; $pf = Join-Path $root 'config\prix.json'
if (Test-Path $pf) { $p = Get-Content $pf -Raw -Encoding utf8 | ConvertFrom-Json }
Write-Output '== Économie estimée =='
Write-Output ("Tokens traités en local, non envoyés à une IA payante : {0:N0} en entrée, {1:N0} en sortie, {2:N0} relus du cache" -f $inTok, $outTok, $cache)
if ($p -and $p.usd_per_million_input_tokens -and $p.usd_per_million_output_tokens) {
  $cachedRate = if ($p.usd_per_million_cached_input_tokens) { $p.usd_per_million_cached_input_tokens } else { $p.usd_per_million_input_tokens }
  $usd = ($inTok * $p.usd_per_million_input_tokens + $outTok * $p.usd_per_million_output_tokens + $cache * $cachedRate) / 1e6
  $line = "Le même volume sur {0} aurait coûté environ {1:N2} $" -f $p.reference_cloud_model, $usd
  if ($p.eur_per_usd) { $line += (" ({0:N2} €)" -f ($usd * $p.eur_per_usd)) } else { $line += ' (taux euro non renseigné)' }
  Write-Output "$line — prix de $($p.source_url), lus le $($p.read_on)."
  Write-Output 'Plafond, pas un gain net : le modèle payant aurait peut-être utilisé moins de tokens, et ce que la session payante a dépensé pour déléguer et vérifier n''est pas déduit. Électricité locale non déduite.'
} else {
  Write-Output "Montant inconnu : remplis $pf (modèle de référence, prix officiels datés)."
}
# `opencode stats` starts a shared background service that would keep querying the local engine:
# stop it unless a local run is alive (its lock file says so).
if (-not (Test-Path (Join-Path $root 'logs\run.lock'))) {
  Get-CimInstance Win32_Process -Filter "Name like 'opencode%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'serve' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
exit 0
