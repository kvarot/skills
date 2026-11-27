import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ouvrirBase } from '../../outils/lib/base.mjs'

function dossierTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'geo-base-'))
}

test('ouverture deux fois : migration appliquee une seule fois, dossier parent cree', async () => {
  const dir = dossierTemp()
  const fichier = path.join(dir, 'sous', 'geo.sqlite')
  try {
    const b1 = await ouvrirBase(fichier)
    b1.fermer()
    const b2 = await ouvrirBase(fichier)
    b2.fermer()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(fichier)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM migration').get().n, 1)
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    db.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('enregistrerAudit puis dernierAudit : memes constats, dernier gagne', async () => {
  const dir = dossierTemp()
  try {
    const base = await ouvrirBase(path.join(dir, 'geo.sqlite'))
    const constats = [{ id: 'GEO-X', preuve: { type: 'http', url: 'https://a.example/', detail: 'curl' } }]
    assert.equal(base.dernierAudit('https://a.example'), null)
    const id1 = base.enregistrerAudit({ origine: 'https://a.example', version_moteur: '0.1.0', collecte_resume: { pages: 1 }, constats: [] })
    const id2 = base.enregistrerAudit({ origine: 'https://a.example', version_moteur: '0.1.0', collecte_resume: { pages: 2 }, constats })
    assert.ok(id2 > id1)
    const audit = base.dernierAudit('https://a.example')
    assert.equal(audit.id, id2)
    assert.deepEqual(audit.constats, constats)
    assert.deepEqual(audit.resume, { pages: 2 })
    assert.equal(base.dernierAudit('https://autre.example'), null)
    base.fermer()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('enregistrerJeu / jeu : relecture, empreinte dupliquee refusee en francais', async () => {
  const dir = dossierTemp()
  try {
    const base = await ouvrirBase(path.join(dir, 'geo.sqlite'))
    const jeu = {
      origine: 'https://a.example', empreinte: 'abc123', version: '1', langue: 'fr', pays: 'FR', niveau: 'standard', graine: 42,
      scenarios: [{ texte: 'Quel est le meilleur plombier ?', profil: 'particulier', intention: 'recherche', poids: 1.5, avec_marque: false }],
    }
    const id = base.enregistrerJeu(jeu)
    assert.ok(id > 0)
    const lu = base.jeu('abc123')
    assert.equal(lu.langue, 'fr')
    assert.equal(lu.scenarios.length, 1)
    assert.equal(lu.scenarios[0].avec_marque, false)
    assert.equal(base.jeu('inconnu'), null)
    assert.throws(() => base.enregistrerJeu(jeu), /empreinte.*existe déjà/)
    assert.equal(base.jeu('abc123').scenarios.length, 1)
    base.fermer()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('contraintes : concurrent.origine hors liste refusee, cles etrangeres actives', async () => {
  const dir = dossierTemp()
  const fichier = path.join(dir, 'geo.sqlite')
  try {
    const base = await ouvrirBase(fichier)
    base.enregistrerAudit({ origine: 'https://a.example', version_moteur: '0.1.0', collecte_resume: {}, constats: [] })
    base.fermer()
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(fichier)
    db.exec('PRAGMA foreign_keys=ON')
    assert.throws(() => db.prepare("INSERT INTO concurrent(site_id, nom, origine, confirme) VALUES (1, 'X', 'autre', 0)").run(), /CHECK/)
    db.prepare("INSERT INTO concurrent(site_id, nom, origine, confirme) VALUES (1, 'X', 'declare', 0)").run()
    assert.throws(() => db.prepare("INSERT INTO concurrent(site_id, nom, origine, confirme) VALUES (999, 'X', 'declare', 0)").run(), /FOREIGN KEY/)
    db.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('migration en echec : transaction annulee, rien d\'applique', async () => {
  const dir = dossierTemp()
  try {
    const { appliquerMigrations } = await import('../../outils/lib/base.mjs')
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path.join(dir, 'x.sqlite'))
    assert.throws(() => appliquerMigrations(db, [
      { version: 1, sql: 'CREATE TABLE a(id INTEGER)' },
      { version: 2, sql: 'CREATE TABLE b(id INTEGER); INSERT INTO inexistante VALUES (1)' },
    ]), /Migration 2/)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
    assert.ok(tables.includes('a'))
    assert.ok(!tables.includes('b'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM migration').get().n, 1)
    db.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('stderr vide a l\'ouverture (pas d\'ExperimentalWarning)', () => {
  const dir = dossierTemp()
  try {
    const mod = path.resolve('plugins/geo/outils/lib/base.mjs')
    const code = `import(${JSON.stringify(pathToFileURL(mod).href)}).then(async m => { const b = await m.ouvrirBase(${JSON.stringify(path.join(dir, 'g.sqlite'))}); b.fermer() })`
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
