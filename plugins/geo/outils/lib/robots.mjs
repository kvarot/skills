// Adapted from plugins/seo/outils/collecter.mjs (same author, MIT): the path-pattern matcher.
// Full RFC 9309 robots.txt parsing (per-product-token groups, merging, longest match) and
// per-crawler evaluation against the AI crawler registry in donnees/robots.json.

// robots.txt path pattern: `*` matches any run of characters, a final `$` anchors the end,
// everything else (a `$` elsewhere included) is literal; without `$` the pattern is a prefix.
// Two-pointer wildcard match with backtracking to the last star only: O(pattern x path), never exponential.
export function correspond(motif, chemin) {
  let p = String(motif).replace(/\*+/g, '*')
  if (p.endsWith('$')) p = p.slice(0, -1)
  else p += '*'
  let i = 0, j = 0, etoile = -1, reprise = 0
  while (j < chemin.length) {
    if (i < p.length && p[i] !== '*' && p[i] === chemin[j]) { i++; j++ }
    else if (i < p.length && p[i] === '*') { etoile = i++; reprise = j }
    else if (etoile >= 0) { i = etoile + 1; j = ++reprise }
    else return false
  }
  while (i < p.length && p[i] === '*') i++
  return i === p.length
}

// RFC 9309 §2.2.2: compare octets after percent-encoding normalisation. Non-ASCII characters are
// UTF-8 encoded, unreserved characters are decoded, remaining escapes are upper-cased.
function normaliser(s) {
  let t = String(s)
  try { t = t.replace(/[^\x00-\x7f]+/gu, (m) => encodeURIComponent(m)) } catch { /* lone surrogate: keep as is */ }
  return t.replace(/%([0-9a-fA-F]{2})/g, (tout, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16))
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`
  })
}

// Parse a robots.txt body. Never throws; null/undefined reads as an absent file.
// `options.repli` maps a lower-cased token to the token whose group it falls back on when no group
// names it (e.g. { applebot: 'Googlebot' }); the fallback is tried before the `*` group.
export function analyserRobots(txt, options = {}) {
  const repli = options.repli ?? {}
  const groupes = []
  const sitemaps = []
  let contentSignal = null
  let courant = null
  let enAgents = false
  const brut = String(txt ?? '').replace(/^\uFEFF/, '')
  for (const ligne of brut.split(/\r\n|\n|\r/)) {
    const m = /^([^:\s]+)\s*:\s*(.*)$/.exec(ligne.replace(/#.*/, '').trim())
    if (!m) continue
    const cle = m[1].toLowerCase()
    const val = m[2].trim()
    if (cle === 'user-agent') {
      // Consecutive User-agent lines share one group; a new one after a rule starts a new group.
      if (!enAgents || !courant) { courant = { agents: [], regles: [] }; groupes.push(courant) }
      if (val) courant.agents.push(val.toLowerCase())
      enAgents = true
    } else if (cle === 'allow' || cle === 'disallow') {
      enAgents = false
      // Rules before any User-agent line are ignored; an empty value is no rule.
      if (courant && val) courant.regles.push({ type: cle, motif: val })
    } else if (cle === 'sitemap') {
      if (val) sitemaps.push(val)
    } else if (cle === 'content-signal') {
      if (contentSignal === null && val) contentSignal = val
    } else {
      enAgents = false
    }
  }

  const groupesDe = (jeton) => {
    const j = String(jeton).toLowerCase()
    const specifiques = groupes.filter((g) => g.agents.includes(j))
    if (specifiques.length) return { type: 'specifique', liste: specifiques }
    const autre = repli[j]
    if (autre) {
      const k = String(autre).toLowerCase()
      const viaRepli = groupes.filter((g) => g.agents.includes(k))
      if (viaRepli.length) return { type: 'repli', liste: viaRepli }
    }
    const etoile = groupes.filter((g) => g.agents.includes('*'))
    if (etoile.length) return { type: 'etoile', liste: etoile }
    return { type: 'aucun', liste: [] }
  }

  return {
    groupes,
    contentSignal,
    sitemaps,
    groupeApplique: (jeton) => groupesDe(jeton).type,
    // Longest matching pattern wins; Allow wins a tie; no matching rule means allowed.
    autorise(jeton, chemin) {
      const cible = normaliser(chemin)
      let meilleure = null
      let longueur = -1
      for (const g of groupesDe(jeton).liste) {
        for (const r of g.regles) {
          const motif = normaliser(r.motif)
          if (!correspond(motif, cible)) continue
          const allow = r.type === 'allow'
          if (motif.length > longueur || (motif.length === longueur && allow && meilleure === false)) {
            meilleure = allow
            longueur = motif.length
          }
        }
      }
      return meilleure === null ? true : meilleure
    },
  }
}

// Verdict per registry entry: which of the given paths each crawler is blocked from.
// `registre` is the parsed donnees/robots.json or its `robots` array.
export function evaluerRobotsIa(robotsTxt, chemins, registre) {
  const liste = Array.isArray(registre) ? registre : (registre?.robots ?? [])
  const repli = {}
  for (const e of liste) if (e.repli) repli[e.jeton.toLowerCase()] = e.repli
  const analyse = analyserRobots(robotsTxt, { repli })
  return liste.map((e) => ({
    jeton: e.jeton,
    role: e.role,
    documente: e.documente,
    chemins_bloques: chemins.filter((c) => !analyse.autorise(e.jeton, c)),
    groupe: analyse.groupeApplique(e.jeton),
  }))
}
