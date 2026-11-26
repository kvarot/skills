# opencode-local.exemple.ps1 — copy to $env:AI_ROOT\scripts\opencode-local.ps1.
# Runs OpenCode with all of its own files under $env:AI_ROOT and the local engine only.
$root = $env:AI_ROOT; if (-not $root) { throw 'AI_ROOT is not set.' }
$oc = Join-Path $root 'agents\opencode'
$env:OPENCODE_CONFIG_DIR = "$oc\config"
$env:XDG_DATA_HOME = "$oc\data"; $env:XDG_CACHE_HOME = "$oc\cache"; $env:XDG_STATE_HOME = "$oc\state"
$env:PWD = (Get-Location).Path   # the agent must see the real current directory, not an inherited PWD
$env:TMP = "$root\temp"; $env:TEMP = "$root\temp"; $env:npm_config_cache = "$root\cache\npm"
& (Join-Path $root 'agents\npm\opencode.cmd') @args