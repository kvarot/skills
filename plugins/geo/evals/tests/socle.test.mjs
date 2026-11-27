import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const GEO = path.join(RACINE, 'plugins/geo/outils/geo.mjs')
const SORTIE = path.join(RACINE, 'plugins/geo/outils/lib/sortie.mjs')
const lireJson = (p) => JSON.parse(readFileSync(path.join(RACINE, p), 'utf8'))

test('marketplace : geo ajouté, seo et ia-locale conservés', () => {
  const noms = lireJson('.claude-plugin/marketplace.json').plugins
  assert.ok(noms.some((p) => p.name === 'geo' && p.source === './plugins/geo'))
  assert.ok(noms.some((p) => p.name === 'seo'))
  assert.ok(noms.some((p) => p.name === 'ia-locale'))
})

test('plugin.json et licences', () => {
  const p = lireJson('plugins/geo/.claude-plugin/plugin.json')
  assert.equal(p.name, 'geo')
  assert.equal(p.license, 'MIT')
  assert.equal(p.version, '0.1.0')
  assert.match(readFileSync(path.join(RACINE, 'plugins/geo/LICENSE'), 'utf8'), /MIT License/)
  assert.match(readFileSync(path.join(RACINE, 'LICENSE'), 'utf8'), /plugins\/geo\//)
})

test('extrait : borné, échappé, sans caractères de contrôle ni invisibles', async () => {
  const { extrait } = await import(pathToFileURL(SORTIE).href)
  const r = extrait('<script>alert(1)</script>' + 'a'.repeat(400))
  assert.ok(r.extrait.length <= 280)
  assert.ok(!r.extrait.includes('<'))
  assert.equal(r.non_fiable, true)
  assert.equal(extrait('x\u200by\u0007z').extrait, 'xyz')
  assert.equal(extrait('a & "b"').extrait, 'a &amp; &quot;b&quot;')
})

test('extrait : retire étiquettes Unicode, sélecteurs de variation et annotations', async () => {
  const { extrait } = await import(pathToFileURL(SORTIE).href)
  assert.equal(extrait('a󠁁b').extrait, 'ab')
  assert.equal(extrait('a️b󠄀c').extrait, 'abc')
  assert.equal(extrait('a￹b￻c').extrait, 'abc')
})

test('cheminDonnees : GEO_HOME sinon <cwd>/.claude/geo', async () => {
  const { cheminDonnees } = await import(pathToFileURL(SORTIE).href)
  const avant = process.env.GEO_HOME
  try {
    delete process.env.GEO_HOME
    assert.equal(cheminDonnees('/x/y'), path.join('/x/y', '.claude', 'geo'))
    process.env.GEO_HOME = '/donnees'
    assert.equal(cheminDonnees('/x/y'), '/donnees')
  } finally {
    if (avant === undefined) delete process.env.GEO_HOME
    else process.env.GEO_HOME = avant
  }
})

test('CLI : --version et commande inconnue', () => {
  const v = spawnSync(process.execPath, [GEO, '--version'], { encoding: 'utf8' })
  assert.equal(v.status, 0)
  assert.deepEqual(JSON.parse(v.stdout), { version: '0.1.0' })
  const i = spawnSync(process.execPath, [GEO, 'inconnue'], { encoding: 'utf8' })
  assert.equal(i.status, 1)
  assert.equal(i.stdout, '')
  assert.match(i.stderr, /Usage/)
})

test('silencerAvertissementSqlite : aucun avertissement sur stderr', () => {
  const dossier = mkdtempSync(path.join(tmpdir(), 'geo-'))
  try {
    const script = path.join(dossier, 's.mjs')
    writeFileSync(script, `import { silencerAvertissementSqlite } from ${JSON.stringify(pathToFileURL(SORTIE).href)}
silencerAvertissementSqlite()
const { DatabaseSync } = await import('node:sqlite')
new DatabaseSync(':memory:').close()
`)
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
  } finally { rmSync(dossier, { recursive: true, force: true }) }
})

const LISTE_NOIRE = path.join(RACINE, 'plugins/geo/evals/.noms-interdits.local')
test('confidentialité : aucun nom interdit dans les fichiers suivis', { skip: existsSync(LISTE_NOIRE) ? false : 'liste locale .noms-interdits.local absente' }, () => {
  const mots = readFileSync(LISTE_NOIRE, 'utf8').split(/\r?\n/).map((m) => m.trim().toLowerCase()).filter(Boolean)
  const fichiers = execFileSync('git', ['ls-files', 'plugins/geo', 'docs/geo'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const f of fichiers) {
    const texte = readFileSync(path.join(RACINE, f), 'utf8').toLowerCase()
    for (const m of mots) assert.ok(!texte.includes(m), `${f} contient un nom interdit`)
  }
})

// Front matter of a Markdown file: the `key: value` lines between the leading `---` fences.
function frontMatter(texte) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(texte)
  if (!m) return null
  const champs = {}
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([a-z-]+):\s*(.*)$/.exec(l)
    if (k) champs[k[1]] = k[2].trim()
  }
  return champs
}

test('skills : front matter name = dossier, description présente, 120 lignes au plus', () => {
  const dir = path.join(RACINE, 'plugins/geo/skills')
  const noms = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  assert.deepEqual(noms, ['geo', 'geo-contenu', 'geo-entites', 'geo-scenarios', 'geo-technique'])
  for (const n of noms) {
    const texte = readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8')
    const fm = frontMatter(texte)
    assert.ok(fm, `${n} : front matter absent`)
    assert.equal(fm.name, n)
    assert.ok(fm.description && fm.description.length >= 40 && fm.description.length <= 1024, `${n} : description absente ou hors limites`)
    const lignes = texte.split(/\r?\n/).length
    assert.ok(lignes <= 120, `${n} : ${lignes} lignes`)
    if (n !== 'geo') assert.ok(lignes < 80, `${n} : ${lignes} lignes (spécialisé < 80)`)
  }
})

test('agent lecteur-contenu : outil de lecture seul ; point d’entrée unique : le skill geo porte les sous-commandes', () => {
  const agent = frontMatter(readFileSync(path.join(RACINE, 'plugins/geo/agents/lecteur-contenu.md'), 'utf8'))
  assert.equal(agent.name, 'lecteur-contenu')
  assert.equal(agent.tools, 'Read')
  assert.ok(!existsSync(path.join(RACINE, 'plugins/geo/commands')), 'pas de commande : le skill geo est le seul point d’entrée')
  const geo = readFileSync(path.join(RACINE, 'plugins/geo/skills/geo/SKILL.md'), 'utf8')
  for (const sc of ['audit', 'quick', 'deep', 'technical', 'content', 'report', 'cost']) assert.match(geo, new RegExp('`' + sc + '[ `]'), sc)
  for (const sc of ['visibility', 'citations', 'competitors']) assert.match(geo, new RegExp('`' + sc + '`[^\\n]*prévu en 0\\.2'), sc)
  for (const sc of ['why-not', 'fix', 'verify', 'compare', 'history', 'monitor', 'logs', 'benchmark']) assert.match(geo, new RegExp('`' + sc + '`[^\\n]*prévu en 0\\.3'), sc)
})
