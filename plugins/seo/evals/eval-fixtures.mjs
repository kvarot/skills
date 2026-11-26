// End-to-end evaluation of the seo plugin on the seeded fixtures (evals/fixtures/*).
// Same runner style as eval-declenchement.mjs (headless `claude -p`, stream-json parsing),
// itself adapted from validation-produit and the anthropics/skills runner (Apache-2.0).
// For each fixture: copy to a temp folder (verite.json left out), git init + initial commit,
// then three phases chained in ONE conversation (--session-id, then --resume):
//   1. audit without fixing, profile confirmed as proposed;
//   2. fix: html-statique first approves the `meta` lot only, then every fixture approves all lots;
//   3. re-audit.
// Checks follow evals/fixtures/README.md and the task 12 brief. Results carry no machine path.
// Tools: Read, Grep, Glob, Edit, Write, Bash(node:*), Skill, Agent; no MCP server except
// permission-seo.mjs, which answers the prompts headless runs cannot (writes under .claude/seo/ only).
// php fixture: the harness serves the copy with php -S around each phase and gives its URL.
//   node eval-fixtures.mjs [--fixture propre,php] [--modele sonnet] [--parallele 1]
//                          [--budget 8] [--sortie resultats-fixtures-v1.json] [--garder]
// --fixture: results are merged into the existing output file (other fixtures kept).
// --garder: keep the temp copies (their path is printed on stderr only).
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collecterDossier, collecterUrl } from '../outils/collecter.mjs'
import { controler } from '../outils/controler.mjs'
import { lireProfil, validerProfil } from '../outils/profil.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..')
const fxDir = path.join(here, 'fixtures')
const a = {}
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '')
  if (k === 'garder') a.garder = true
  else a[k] = process.argv[++i]
}
const modele = a.modele || 'sonnet'
const parallele = Math.max(1, Number(a.parallele || 1))
const budget = String(a.budget || 8)
const sortie = a.sortie ? path.resolve(a.sortie) : path.join(here, 'resultats-fixtures-v1.json')
const TOUTES = readdirSync(fxDir).filter((n) => existsSync(path.join(fxDir, n, 'verite.json'))).sort()
const choisies = a.fixture ? a.fixture.split(',').map((s) => s.trim()).filter(Boolean) : TOUTES
for (const n of choisies) if (!TOUTES.includes(n)) { console.error('fixture inconnue : ' + n); process.exit(2) }
const TIMEOUT_MS = 45 * 60 * 1000
const today = new Date().toISOString().slice(0, 10)
const GRAVES = new Set(['bloquant', 'important'])
// Short hash of this script: tells which results were produced by which harness version.
const versionHarnais = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12)

// --- helpers -----------------------------------------------------------------

const slash = (p) => String(p).split('\\').join('/')
// Every spelling of a local path that may appear in model output, longest first.
function variantes(p) {
  const s = slash(p)
  const v = [p, s]
  const m = /^([A-Za-z]):\/(.*)$/.exec(s)
  if (m) v.push(`/${m[1].toLowerCase()}/${m[2]}`, `/${m[1].toUpperCase()}/${m[2]}`)
  return [...new Set(v)].sort((x, y) => y.length - x.length)
}
// Removes machine paths from text kept in the results.
function nettoyer(txt, copie) {
  let t = String(txt ?? '')
  const subs = []
  if (copie) subs.push([copie, '<fixture>'])
  subs.push([pluginDir, '<plugin>'], [os.tmpdir(), '<tmp>'], [os.homedir(), '<home>'])
  for (const [p, r] of subs) for (const v of variantes(p)) t = t.split(v).join(r)
  return t
}
const tronquer = (t, n = 500) => (t.length > n ? t.slice(0, n) + '…' : t)

// fichier_source → normalised path relative to the fixture root.
function normaliserSource(f, copie) {
  if (typeof f !== 'string') return null
  let s = slash(f.trim())
  for (const v of variantes(copie)) if (s.toLowerCase().startsWith(slash(v).toLowerCase())) { s = s.slice(v.length); break }
  s = s.replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '').replace(/^\/+/, '')
  return s.toLowerCase()
}
// Source file → URL path of the page it renders (index.* → its folder).
const pageDe = (f) => '/' + slash(f).replace(/(^|\/)index\.(html|php)$/i, '$1')
const cheminPage = (p) => { try { return new URL(p).pathname } catch { return p.startsWith('/') ? p : '/' + p } }
// URL path → file of a static/php site.
const fichierDePage = (p) => { const c = cheminPage(p).replace(/^\//, ''); return (c === '' || c.endsWith('/')) ? c + 'index.html' : c }

function git(cwd, ...args) {
  // core.excludesFile= : a global ignore file must not hide files written by the model.
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', '-c', 'core.excludesFile=', '-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })
}
// Paths changed (tracked or untracked) since `ref`, relative, forward slashes.
function changes(cwd, ref) {
  git(cwd, 'add', '-A')
  return git(cwd, 'diff', '--cached', '--name-only', ref).split('\n').map((s) => s.trim()).filter(Boolean)
}
// Added lines per file since `ref` (outside .claude/).
function ajouts(cwd, ref) {
  git(cwd, 'add', '-A')
  const out = git(cwd, 'diff', '--cached', '--no-color', '-U0', ref, '--', '.', ':(exclude).claude')
  const res = {}
  let f = null
  for (const l of out.split('\n')) {
    const m = /^\+\+\+ b\/(.*)$/.exec(l)
    if (m) { f = m[1]; res[f] = res[f] || []; continue }
    if (f && l.startsWith('+') && !l.startsWith('+++')) res[f].push(l.slice(1))
  }
  return res
}
const snapshot = (cwd, msg) => { git(cwd, 'add', '-A'); try { git(cwd, 'commit', '-q', '--allow-empty', '-m', msg) } catch {} ; return git(cwd, 'rev-parse', 'HEAD').trim() }

function lireTout(dir, exclure = []) {
  let t = ''
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || exclure.includes(e.name)) continue
    const p = path.join(dir, e.name)
    t += e.isDirectory() ? lireTout(p) : '\n' + readFileSync(p, 'utf8')
  }
  return t
}
function chercherMotif(base, cible, re) {
  const p = path.join(base, cible)
  if (!existsSync(p)) return { trouve: false, fichiers: [] }
  if (statSync(p).isFile()) return { trouve: re.test(readFileSync(p, 'utf8')), fichiers: re.test(readFileSync(p, 'utf8')) ? [cible] : [] }
  const fichiers = []
  const parcourir = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (['.git', '.claude', 'node_modules'].includes(e.name)) continue
      const q = path.join(d, e.name)
      if (e.isDirectory()) parcourir(q)
      else if (re.test(readFileSync(q, 'utf8'))) fichiers.push(slash(path.relative(base, q)))
    }
  }
  parcourir(p)
  return { trouve: fichiers.length > 0, fichiers }
}

const portLibre = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const serveurs = new Set()
async function demarrerPhp(racine) {
  const port = await portLibre()
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', racine], { stdio: 'ignore' })
  serveurs.add(proc)
  let echec = null
  proc.on('error', (e) => { echec = e; serveurs.delete(proc) })
  proc.on('exit', () => serveurs.delete(proc))
  for (let i = 0; i < 50; i++) {
    if (echec) throw new Error('php -S : ' + (echec.code || echec.message))
    try { await fetch(`http://127.0.0.1:${port}/`); return { port, proc, url: `http://127.0.0.1:${port}/` } } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  proc.kill()
  throw new Error('php -S ne répond pas')
}
const arreterPhp = (s) => { if (s) try { s.proc.kill() } catch {} }
const toutArreter = () => { for (const p of serveurs) try { p.kill() } catch {} }
process.on('exit', toutArreter)
process.on('SIGINT', () => { toutArreter(); process.exit(130) })

// Constats of the current rendering of the copy (harness side, deterministic).
async function constatsHarnais(copie, verite, serveur) {
  if (verite.rendu_local === 'dossier') {
    const { pages, site } = collecterDossier(path.join(copie, verite.racine_rendu ?? '.'))
    return controler(pages, site)
  }
  if (verite.rendu_local === 'php-s') {
    const r = await collecterUrl(serveur.url, { delaiMs: 0 })
    return controler(r.pages, r.site)
  }
  return null
}

// --- one claude -p phase -------------------------------------------------------

function phaseClaude({ copie, prompt, sessionId, reprise }) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    delete env.CLAUDECODE
    const args = ['-p', prompt, '--model', modele, '--plugin-dir', pluginDir,
      // Only the permission answerer below as MCP server: writes under .claude/ always prompt.
      '--setting-sources', 'project,local', '--strict-mcp-config',
      '--mcp-config', JSON.stringify({ mcpServers: { perm: { command: 'node', args: [path.join(here, 'permission-seo.mjs'), copie] } } }),
      '--permission-prompt-tool', 'mcp__perm__approuver',
      '--tools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Skill', 'Agent',
      '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(node:*)', 'Skill', 'Agent',
      '--max-budget-usd', budget,
      '--output-format', 'stream-json', '--verbose',
      ...(reprise ? ['--resume', sessionId] : ['--session-id', sessionId])]
    const debut = Date.now()
    const c = spawn('claude', args, { cwd: copie, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const r = { statut: 'erreur', raison: null, reponse: '', cout_usd: null, tours: null, skills: [], agents: [], outils: {}, refus: [] }
    let buf = ''
    let regle = false
    const t = setTimeout(() => { r.statut = 'timeout'; r.raison = 'timeout'; try { c.kill() } catch {} }, TIMEOUT_MS)
    c.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        if (j.type === 'assistant') for (const b of j.message?.content || []) {
          if (b.type !== 'tool_use') continue
          r.outils[b.name] = (r.outils[b.name] || 0) + 1
          if (b.name === 'Skill') r.skills.push(String(b.input?.skill ?? ''))
          if (b.name === 'Agent' || b.name === 'Task') r.agents.push(String(b.input?.subagent_type ?? ''))
        }
        if (j.type === 'result') {
          r.reponse = String(j.result ?? '')
          r.cout_usd = j.total_cost_usd ?? null
          r.tours = j.num_turns ?? null
          r.refus = (j.permission_denials || []).map((x) => tronquer(nettoyer(x.tool_name + (x.tool_input?.command ? ' ' + x.tool_input.command : x.tool_input?.file_path ? ' ' + x.tool_input.file_path : ''), copie), 120))
          if (j.is_error || (j.subtype && j.subtype !== 'success')) { r.statut = 'erreur'; r.raison = 'result ' + (j.subtype || 'error') }
          else { r.statut = 'ok'; r.raison = null }
        }
      }
    })
    c.stderr.on('data', () => {})
    const clore = (raison) => {
      if (regle) return
      regle = true
      clearTimeout(t)
      if (r.statut !== 'ok' && !r.raison) r.raison = raison
      r.duree_s = Math.round((Date.now() - debut) / 1000)
      resolve(r)
    }
    c.on('error', (e) => clore('spawn ' + (e.code || e.message)))
    c.on('close', (code) => clore('exit ' + code))
  })
}

// --- checks --------------------------------------------------------------------

function lireAudit(copie) {
  const f = path.join(copie, '.claude', 'seo', 'audit.json')
  if (!existsSync(f)) return { audit: null, erreur: 'audit.json absent' }
  let j
  try { j = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { return { audit: null, erreur: 'audit.json illisible : ' + e.message } }
  const e = []
  if (typeof j?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) e.push('date')
  if (!('stack' in (j || {}))) e.push('stack')
  if (!Array.isArray(j?.constats)) e.push('constats')
  else j.constats.forEach((c, i) => {
    if (typeof c?.controle !== 'string' || !['bloquant', 'important', 'mineur'].includes(c?.severite) || typeof c?.lot !== 'string' || !Array.isArray(c?.pages) || typeof c?.fichier_source !== 'string') e.push(`constats[${i}]`)
  })
  return { audit: j, erreur: e.length ? 'champs invalides : ' + e.slice(0, 8).join(', ') : null }
}
function lireProfilCopie(copie) {
  const f = path.join(copie, '.claude', 'seo', 'profil.md')
  if (!existsSync(f)) return { meta: null, erreurs: ['profil.md absent'] }
  try { const { meta } = lireProfil(f); return { meta, erreurs: validerProfil(meta) } } catch (e) { return { meta: null, erreurs: ['illisible : ' + e.message] } }
}
const trouverConstats = (audit, d, copie) => (audit?.constats || []).filter((c) => c.controle === d.controle && normaliserSource(c.fichier_source, copie) === normaliserSource(d.fichier_source, copie))

// Is control `d.controle` still raised on the page rendered by d.fichier_source?
function encorePresent(constats, avant, d) {
  const page = pageDe(d.fichier_source)
  const scopeAvant = (avant || []).some((c) => c.controle === d.controle && c.pages.map(cheminPage).includes(page))
  const memes = constats.filter((c) => c.controle === d.controle)
  if (scopeAvant) return memes.some((c) => c.pages.map(cheminPage).includes(page)) ? `${d.controle} encore relevé sur ${page}` : null
  return memes.length ? `${d.controle} encore relevé (${memes.flatMap((c) => c.pages.map(cheminPage)).slice(0, 4).join(', ')})` : null
}

const RE_NOMBRE = /\d{2,}/g
const RE_AVIS = /AggregateRating|"@type"\s*:\s*"Review"|reviewRating/i
const RE_MOTS_FR = /\b(le|la|les|des|et|du|pour)\b/i
const RE_DROIT_LOCAL = /droit local|droit applicable localement|local law|lois? locales?|r[éè]glementation locale|r[éè]gles locales|local (rules|regulations|legislation)|droit (britannique|anglais|du Royaume-Uni)|UK law/i

function verifierContenu(copie, ref, origine) {
  const add = ajouts(copie, ref)
  const inventes = []
  const avis = []
  for (const [f, lignes] of Object.entries(add)) {
    for (const l of lignes) {
      // Today's ISO date (e.g. sitemap lastmod) is not a claim about the practice.
      const sans = l.split(today).join('')
      for (const n of sans.match(RE_NOMBRE) || []) if (!origine.has(n)) inventes.push(`${f}: ${n}`)
      if (RE_AVIS.test(l)) avis.push(f)
    }
  }
  return { add, inventes: [...new Set(inventes)], avis: [...new Set(avis)] }
}
// New meta description texts in added twig lines (literal text only, Twig expressions removed).
function descriptionsTwig(add) {
  const textes = []
  for (const [f, lignes] of Object.entries(add)) {
    if (!/\.twig$/.test(f)) continue
    const t = lignes.join('\n')
    for (const m of t.matchAll(/\{%\s*block\s+(?:meta_)?description\s*%\}([\s\S]*?)\{%\s*endblock/gi)) textes.push(m[1])
    for (const m of t.matchAll(/name=["']description["'][^>]*content=["']([^"']*)["']/gi)) textes.push(m[1])
    for (const m of t.matchAll(/\{%\s*set\s+(?:meta_)?description\s*=\s*(["'])([\s\S]*?)\1/gi)) textes.push(m[2])
  }
  return textes.map((x) => x.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// --- one fixture -----------------------------------------------------------------

async function evaluerFixture(nom) {
  const verite = JSON.parse(readFileSync(path.join(fxDir, nom, 'verite.json'), 'utf8'))
  const copie = mkdtempSync(path.join(os.tmpdir(), `seo-fx-${nom}-`))
  cpSync(path.join(fxDir, nom), copie, { recursive: true, filter: (s) => path.basename(s) !== 'verite.json' })
  git(copie, 'init', '-q')
  const ref0 = snapshot(copie, 'fixture')
  const origine = new Set(lireTout(path.join(fxDir, nom), ['verite.json']).match(RE_NOMBRE) || [])
  const sessionId = randomUUID()
  const res = { statut: 'ok', phases: [], defauts: [], controles: [] }
  const ctl = (n, pass, raison = null, extra = {}) => { res.controles.push({ nom: n, pass, raison, ...extra }); return pass }
  const log = (m) => console.error(`[${nom}] ${m}`)
  if (a.garder) log('copie : ' + copie)
  const defauts = verite.defauts.map((d) => ({ controle: d.controle, fichier_source: d.fichier_source, detection: d.detection, verif_type: d.verif_apres.type, phase1: null, phase2: null, phase3: null }))
  res.defauts = defauts

  // Source outside the collected root (racine_rendu, vue-spa: dist/): its fix is not rendered.
  const horsRendu = (d) => !!verite.racine_rendu && !slash(d.fichier_source).startsWith(verite.racine_rendu + '/')
  let serveur = null
  let coutCumule = 0
  const avecServeur = async (fn) => {
    if (verite.rendu_local !== 'php-s') return fn(null)
    serveur = await demarrerPhp(copie)
    try { return await fn(serveur) } finally { arreterPhp(serveur); serveur = null }
  }
  const suffixe = (s) => (s ? ` Le site de dev tourne sur ${s.url} (serveur lancé par l'évaluation, ne pas le lancer).` : '')
  const sansInteraction = ' (Session sans interaction : je ne pourrai pas répondre aux questions.)'
  const lancer = async (phase, texte, reprise) => avecServeur(async (s) => {
    const prompt = texte + suffixe(s) + sansInteraction
    log(`phase ${phase}…`)
    const r = await phaseClaude({ copie, prompt, sessionId, reprise })
    // total_cost_usd is cumulative over a resumed session: keep the phase's own share.
    const cumul = r.cout_usd
    if (cumul !== null) { r.cout_usd = Number(Math.max(0, cumul - coutCumule).toFixed(4)); coutCumule = Math.max(coutCumule, cumul) }
    log(`phase ${phase} : ${r.statut} ${r.duree_s}s ${r.cout_usd ?? '?'}$`)
    res.phases.push({ phase, prompt: nettoyer(texte, copie), statut: r.statut, raison: r.raison, duree_s: r.duree_s, cout_usd: r.cout_usd, tours: r.tours,
      skills: r.skills, agents: r.agents, outils: r.outils, refus: r.refus, reponse: tronquer(nettoyer(r.reponse, copie)) })
    r.texteComplet = r.reponse
    r.constatsHarnais = await constatsHarnais(copie, verite, s).catch((e) => { log('collecte : ' + e.message); return null })
    return r
  })

  try {
    const avant = await avecServeur((s) => constatsHarnais(copie, verite, s))

    // Phase 1: audit only.
    const p1 = await lancer('1-audit', "Audite le SEO de ce projet sans rien corriger. Le profil que tu proposes est confirmé tel quel. Je confirme le discours que tu proposes tel quel.", false)
    if (p1.statut !== 'ok') throw new Error('phase 1 : ' + p1.raison)
    const hors1 = changes(copie, ref0).filter((f) => !f.startsWith('.claude/seo/'))
    ctl('phase1_aucune_ecriture_hors_claude_seo', hors1.length === 0, hors1.length ? hors1.slice(0, 10).join(', ') : null)
    const { audit: audit1, erreur: e1 } = lireAudit(copie)
    ctl('phase1_audit_json_valide', !!audit1 && !e1, e1)
    const prof1 = lireProfilCopie(copie)
    ctl('phase1_profil_valide', prof1.erreurs.length === 0, prof1.erreurs.join(' ; ') || null)
    if (verite.pays) ctl('phase1_pays_deduit', prof1.meta?.pays === verite.pays, `attendu ${verite.pays}, obtenu ${prof1.meta?.pays ?? 'rien'}`)
    for (const d of defauts) {
      const v = verite.defauts[defauts.indexOf(d)]
      const memeId = (audit1?.constats || []).filter((c) => c.controle === v.controle)
      const bons = trouverConstats(audit1, v, copie)
      d.phase1 = { detecte: memeId.length > 0, bonne_source: bons.length > 0,
        raison: bons.length ? null : memeId.length ? 'source relevée : ' + [...new Set(memeId.map((c) => nettoyer(c.fichier_source, copie)))].join(', ') : 'contrôle absent de audit.json' }
    }
    const attendus = new Set(verite.defauts.map((d) => d.controle))
    res.constats_en_plus = (audit1?.constats || []).filter((c) => !attendus.has(c.controle)).map((c) => `${c.controle} (${c.severite})`)
    if (nom === 'propre') {
      const graves = (audit1?.constats || []).filter((c) => GRAVES.has(c.severite))
      ctl('propre_aucun_constat_grave', !!audit1 && graves.length === 0, !audit1 ? 'audit.json absent' : graves.map((c) => `${c.controle} ${c.severite}`).join(', ') || null)
    }
    const ref1 = snapshot(copie, 'phase 1')

    // Phase 2: fix (html-statique: meta lot first).
    let p2texte = ''
    if (nom === 'html-statique') {
      const p2a = await lancer('2a-lot-meta', "J'approuve uniquement le lot meta. J'approuve aussi les textes et les diffs que tu proposes pour ce lot : écris-les sans me redemander.", true)
      p2texte += p2a.texteComplet + '\n'
      const meta = (audit1?.constats || []).filter((c) => c.lot === 'meta')
      const permis = new Set(meta.flatMap((c) => [normaliserSource(c.fichier_source, copie), ...c.pages.map((p) => fichierDePage(p).toLowerCase())]))
      const ch = changes(copie, ref1).filter((f) => !f.startsWith('.claude/seo/'))
      const horsLot = ch.filter((f) => !permis.has(f.toLowerCase()))
      ctl('phase2a_lot_meta_seul', p2a.statut === 'ok' && ch.length > 0 && horsLot.length === 0,
        p2a.statut !== 'ok' ? p2a.raison : !ch.length ? 'aucun fichier modifié' : horsLot.length ? 'hors lot meta : ' + horsLot.join(', ') : null, { modifies: ch })
    }
    const p2 = await lancer('2-tous-lots', "J'approuve tous les lots proposés. J'approuve aussi les textes et les diffs que tu proposes : écris-les sans me redemander.", true)
    p2texte += p2.texteComplet
    if (p2.statut !== 'ok') res.statut = 'partiel'
    const ref2 = snapshot(copie, 'phase 2')
    const modifies2 = new Set(changes(copie, ref1).filter((f) => !f.startsWith('.claude/')).map((f) => f.toLowerCase()))
    // verif_apres per defect. A detection: controle defect whose source is rendered by the
    // harness is also re-collected, whatever its verif_apres type: a regex on the sources
    // cannot prove the rendered defect is gone (php: same title on every page via seo_meta).
    for (const d of defauts) {
      const v = verite.defauts[defauts.indexOf(d)].verif_apres
      let pass = false, raison = null
      const r = []
      const recollecte = d.detection === 'controle' && !horsRendu(d) && verite.rendu_local !== 'aucun'
      if (recollecte) {
        if (!(avant || []).some((c) => c.controle === d.controle)) r.push(`${d.controle} non relevé par le harnais avant correction`)
        else if (!p2.constatsHarnais) r.push('recollecte impossible')
        else { const e = encorePresent(p2.constatsHarnais, avant, d); if (e) r.push(e) }
      }
      if (v.type === 'controle') {
        if (!recollecte) r.push('verif_apres controle sans recollecte possible')
      } else if (v.type === 'motif') {
        if (v.present !== undefined && !chercherMotif(copie, v.fichier, new RegExp(v.present, 'im')).trouve) r.push(`motif attendu absent de ${v.fichier}`)
        if (v.absent !== undefined) { const m = chercherMotif(copie, v.fichier, new RegExp(v.absent, 'im')); if (m.trouve) r.push(`motif interdit présent dans ${m.fichiers.join(', ')}`) }
      } else if (v.type === 'explication') {
        // R6: judged on the final response of phase 2 (phase 2a included for html-statique).
        if (!new RegExp(v.motif_reponse, 'im').test(p2texte)) r.push('explication absente de la réponse de phase 2')
      }
      pass = r.length === 0; raison = r.join(' ; ') || null
      d.phase2 = { pass, raison }
    }
    // Content rules.
    const cont = verifierContenu(copie, ref0, origine)
    ctl('contenu_aucun_chiffre_invente', cont.inventes.length === 0, cont.inventes.slice(0, 15).join(' ; ') || null)
    ctl('contenu_pas_d_avis_ni_note', cont.avis.length === 0, cont.avis.join(', ') || null)
    if (nom === 'twig') {
      const desc = descriptionsTwig(cont.add)
      const fr = desc.filter((t) => RE_MOTS_FR.test(t))
      ctl('twig_descriptions_en_anglais', desc.length > 0 && fr.length === 0, !desc.length ? 'aucune nouvelle description littérale trouvée' : fr.length ? 'mots-outils français : ' + fr.slice(0, 3).map((t) => tronquer(t, 120)).join(' | ') : null, { descriptions: desc.slice(0, 6).map((t) => tronquer(t, 160)) })
      ctl('twig_reponse_droit_local', RE_DROIT_LOCAL.test(p2texte), RE_DROIT_LOCAL.test(p2texte) ? null : 'droit local non mentionné en phase 2')
    }
    if (nom === 'vue-spa') {
      const pk = (f) => { try { const j = JSON.parse(f); return Object.keys({ ...j.dependencies, ...j.devDependencies }).sort().join(',') } catch { return 'illisible' } }
      const avantPk = pk(readFileSync(path.join(fxDir, nom, 'package.json'), 'utf8'))
      const apresPk = pk(readFileSync(path.join(copie, 'package.json'), 'utf8'))
      ctl('vue_aucune_dependance_ajoutee', avantPk === apresPk, avantPk === apresPk ? null : 'dépendances : ' + apresPk)
    }
    if (nom === 'php') {
      const d0 = defauts.find((d, i) => verite.defauts[i].verif_apres.type === 'motif' && verite.defauts[i].verif_apres.present)
      ctl('php_appel_seo_meta', !!d0?.phase2?.pass, d0?.phase2?.raison ?? null)
    }

    // Phase 3: re-audit.
    const p3 = await lancer('3-relance', "Refais l'audit.", true)
    if (p3.statut !== 'ok') res.statut = 'partiel'
    const hors3 = changes(copie, ref2).filter((f) => !f.startsWith('.claude/seo/'))
    ctl('phase3_aucune_ecriture_hors_claude_seo', hors3.length === 0, hors3.slice(0, 10).join(', ') || null)
    const { audit: audit3, erreur: e3 } = lireAudit(copie)
    ctl('phase3_audit_json_valide', !!audit3 && !e3, e3)
    // Expected historique: the lot of every defect fixed in phase 2 by writing its source file
    // (independent of whether phase 3 can re-check it). An `explication` defect is explained,
    // not written: its lot (vue-spa: architecture) is not expected in historique.
    const lots = new Set()
    for (const d of defauts) {
      const v = verite.defauts[defauts.indexOf(d)]
      if (d.phase2?.pass && v.verif_apres.type !== 'explication' && modifies2.has(normaliserSource(v.fichier_source, copie))) for (const c of trouverConstats(audit1, v, copie)) lots.add(c.lot)
      // A model-read defect (detection: modele) is re-read from the sources by the re-audit;
      // a rendered one cannot show its fix in a versioned build that is not rebuilt.
      if (!d.phase2?.pass || v.verif_apres.type === 'explication' || (d.detection === 'controle' && horsRendu(d))) { d.phase3 = { pass: null, raison: 'non applicable' }; continue }
      const again = trouverConstats(audit3, v, copie)
      d.phase3 = { pass: !!audit3 && again.length === 0, raison: !audit3 ? 'audit.json absent' : again.length ? 'réapparaît dans le nouvel audit' : null }
    }
    if (nom === 'html-statique' && (audit1?.constats || []).some((x) => x.lot === 'meta')) lots.add('meta')
    res.lots_attendus = [...lots]
    const prof3 = lireProfilCopie(copie)
    const hist = (prof3.meta?.historique || []).map((h) => String(h?.lot ?? ''))
    const manquants = [...lots].filter((l) => !hist.some((h) => h === l || h.split(/[^a-z-]+/i).includes(l)))
    ctl('phase3_historique_lots_appliques', prof3.erreurs.length === 0 && manquants.length === 0,
      prof3.erreurs.length ? 'profil : ' + prof3.erreurs.join(' ; ') : manquants.length ? 'lots absents de historique : ' + manquants.join(', ') : null, { historique: hist })
  } catch (e) {
    res.statut = 'erreur'
    res.raison = nettoyer(e.message, copie)
    log('erreur : ' + res.raison)
  } finally {
    arreterPhp(serveur)
    if (!a.garder) try { rmSync(copie, { recursive: true, force: true }) } catch {}
  }
  res.cout_usd = Number(res.phases.reduce((s, p) => s + (p.cout_usd || 0), 0).toFixed(2))
  res.duree_s = res.phases.reduce((s, p) => s + (p.duree_s || 0), 0)
  return res
}

// --- run, merge, thresholds ----------------------------------------------------

const resultats = {}
let suivant = 0
await Promise.all(Array.from({ length: Math.min(parallele, choisies.length) }, async () => {
  while (suivant < choisies.length) { const n = choisies[suivant++]; resultats[n] = await evaluerFixture(n) }
}))

let precedent = {}
if (a.fixture && existsSync(sortie)) try { precedent = JSON.parse(readFileSync(sortie, 'utf8')).fixtures || {} } catch {}
const fixtures = { ...precedent }
for (const [n, r] of Object.entries(resultats)) fixtures[n] = { ...r, modele, harnais: versionHarnais, date: new Date().toISOString() }

const tous = Object.entries(fixtures)
const lesDefauts = tous.flatMap(([, r]) => r.defauts || [])
const detectes = lesDefauts.filter((d) => d.phase1?.bonne_source).length
const ctlDe = (n, nomCtl) => fixtures[n]?.controles?.find((c) => c.nom === nomCtl)
const tousCtl = (nomCtl) => tous.map(([n]) => ctlDe(n, nomCtl)).filter(Boolean)
const seuil = (nomS, pass, detail) => ({ seuil: nomS, pass, detail })
const seuils = [
  seuil('detection_bonne_source_90', lesDefauts.length ? detectes / lesDefauts.length >= 0.9 : null, `${detectes}/${lesDefauts.length}`),
  seuil('phase1_zero_ecriture_hors_claude_seo', tousCtl('phase1_aucune_ecriture_hors_claude_seo').every((c) => c.pass), tousCtl('phase1_aucune_ecriture_hors_claude_seo').filter((c) => !c.pass).length + ' fixture(s) en défaut'),
  seuil('zero_chiffre_invente', tousCtl('contenu_aucun_chiffre_invente').every((c) => c.pass), tous.filter(([n]) => ctlDe(n, 'contenu_aucun_chiffre_invente')?.pass === false).map(([n]) => n).join(', ') || null),
  seuil('propre_zero_bloquant_important', fixtures.propre ? !!ctlDe('propre', 'propre_aucun_constat_grave')?.pass : null, ctlDe('propre', 'propre_aucun_constat_grave')?.raison ?? null),
  seuil('vue_spa_aucune_dependance_de_rendu', fixtures['vue-spa'] ? !!ctlDe('vue-spa', 'vue_aucune_dependance_ajoutee')?.pass && (fixtures['vue-spa'].defauts || []).filter((d) => d.fichier_source === 'package.json').every((d) => d.phase2?.pass) : null, null),
  // R7: a call site of the existing seo_meta() helper anywhere in the tree (definition excluded),
  // and T-TITLE-DOUBLON gone from the php -S re-collection (detection: controle, see phase 2).
  seuil('php_appel_seo_meta', fixtures.php ? !!ctlDe('php', 'php_appel_seo_meta')?.pass : null, ctlDe('php', 'php_appel_seo_meta')?.raison ?? null),
]
const verifs = lesDefauts.filter((d) => d.phase2)
const summary = {
  fixtures: tous.map(([n]) => n), seuils,
  defauts: lesDefauts.length, detectes_bonne_source: detectes,
  verif_apres_reussies: `${verifs.filter((d) => d.phase2.pass).length}/${verifs.length}`,
  relance_sans_reapparition: `${lesDefauts.filter((d) => d.phase3?.pass === true).length}/${lesDefauts.filter((d) => d.phase3 && d.phase3.pass !== null).length}`,
  controles_en_echec: tous.flatMap(([n, r]) => (r.controles || []).filter((c) => !c.pass).map((c) => `${n}:${c.nom}`)),
  defauts_en_echec: tous.flatMap(([n, r]) => (r.defauts || []).flatMap((d) => ['phase2', 'phase3'].filter((p) => d[p]?.pass === false).map((p) => `${n}:${d.controle}:${d.fichier_source}:${p}`))),
  // Fixtures evaluated by another version of this harness than the current one (--fixture merge).
  harnais: versionHarnais,
  fixtures_autre_harnais: tous.filter(([, r]) => r.harnais !== versionHarnais).map(([n]) => n),
  relancees: Object.keys(resultats),
  cout_usd: Number(tous.reduce((s, [, r]) => s + (r.cout_usd || 0), 0).toFixed(2)),
  duree_min: Math.round(tous.reduce((s, [, r]) => s + (r.duree_s || 0), 0) / 60),
}
writeFileSync(sortie, JSON.stringify({ summary, fixtures }, null, 1) + '\n')
console.log(JSON.stringify(summary, null, 1))
// Any failed threshold, phase check or per-defect verification fails the run.
if (tous.some(([, r]) => r.statut === 'erreur') || seuils.some((s) => s.pass === false) || summary.controles_en_echec.length || summary.defauts_en_echec.length) process.exitCode = 1
