import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
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
