# ia-usage.ps1 — what the local AI did, and what it saved.
#   ia-usage.ps1 [-Days 7] [-All]
# Local tokens come from the local agent's own statistics (`opencode stats --json`);
# runs come from $AI_ROOT\logs\runs.jsonl (ia-run.ps1). Money saved is computed ONLY from
# the prices you wrote in $AI_ROOT\config\prix.json (official page, dated); without them
# the report shows tokens and says the amount is unknown — it never guesses a price.
param([int]$Days = 7, [switch]$All)
$ErrorActionPreference = 'Stop'
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$launcher = Join-Path $root 'scripts\opencode-local.ps1'
$statArgs = @('stats') + @(if ($All) { '--all' } else { '--days'; "$Days" }) + @('--models', '--cost', '--json')
$stats = $null
$ErrorActionPreference = 'Continue'
try { $stats = (& $launcher @statArgs 2>$null | Out-String) | ConvertFrom-Json } catch { }
$ErrorActionPreference = 'Stop'

$runs = @()
$log = Join-Path $root 'logs\runs.jsonl'
if (Test-Path $log) {
  $since = if ($All) { [datetime]::MinValue } else { (Get-Date).ToUniversalTime().AddDays(-$Days) }
  $runs = Get-Content $log | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { [datetime]$_.at -ge $since }
}

$period = if ($All) { 'depuis le début' } else { "$Days derniers jours" }
Write-Output "== IA locale : usage ($period) =="
if ($stats) {
  $inTok = [int64]$stats.tokens.input; $outTok = [int64]$stats.tokens.output; $cache = [int64]$stats.tokens.cache.read
  Write-Output ("Sessions de l'agent local : {0} ; demandes : {1} ; étapes : {2}" -f $stats.sessions, $stats.prompts, $stats.steps)
  Write-Output ("Tokens traités en local : {0:N0} en entrée, {1:N0} en sortie, {2:N0} relus du cache" -f $inTok, $outTok, $cache)
  if ($stats.tools) { Write-Output ("Outils : {0} appels, {1} réussis, {2} échoués" -f $stats.tools.totals.calls, $stats.tools.totals.succeeded, $stats.tools.totals.failed) }
} else { Write-Output 'Statistiques de l''agent local indisponibles.'; $inTok = 0; $outTok = 0; $cache = 0 }

if ($runs) {
  $ok = @($runs | Where-Object status -eq 'done').Count
  Write-Output ("Tâches lancées par ia-run : {0} ({1} finies, {2} hors délai) ; durée totale {3:N0} min" -f @($runs).Count, $ok, (@($runs).Count - $ok), (($runs | Measure-Object seconds -Sum).Sum / 60))
  $runs | Group-Object model | ForEach-Object { Write-Output ("  modèle {0} : {1} tâche(s)" -f $_.Name, $_.Count) }
}
try {
  $ps = (Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3).models
  Write-Output ('Modèles chargés maintenant : ' + $(if ($ps) { ($ps | ForEach-Object { "{0} ({1:N1} Go en VRAM)" -f $_.name, ($_.size_vram / 1GB) }) -join ', ' } else { 'aucun' }))
} catch { Write-Output 'Moteur local injoignable.' }

$p = $null; $pf = Join-Path $root 'config\prix.json'
if (Test-Path $pf) { $p = Get-Content $pf -Raw | ConvertFrom-Json }
Write-Output '== Économie estimée =='
if ($p -and $p.usd_per_million_input_tokens -and $p.usd_per_million_output_tokens) {
  $cachedRate = if ($p.usd_per_million_cached_input_tokens) { $p.usd_per_million_cached_input_tokens } else { $p.usd_per_million_input_tokens }
  $usd = ($inTok * $p.usd_per_million_input_tokens + $outTok * $p.usd_per_million_output_tokens + $cache * $cachedRate) / 1e6
  $line = "Le même travail sur {0} aurait coûté environ {1:N2} $" -f $p.reference_cloud_model, $usd
  if ($p.eur_per_usd) { $line += (" ({0:N2} €)" -f ($usd * $p.eur_per_usd)) }
  Write-Output "$line — estimation d'après les prix de $($p.source_url), lus le $($p.read_on) ; électricité locale non déduite."
} else {
  Write-Output "Montant inconnu : remplis $pf (modèle de référence, prix officiels datés). Tokens évités : ces tokens n'ont pas été envoyés à une IA payante."
}
exit 0
