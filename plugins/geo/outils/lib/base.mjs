// Local SQLite store with versioned migrations (node:sqlite, zero dependency).
// ouvrirBase is async because node:sqlite is imported dynamically, after the warning filter is installed.
import fs from 'node:fs'
import path from 'node:path'
import { cheminDonnees, silencerAvertissementSqlite, ErreurGeo } from './sortie.mjs'

// Numbered migrations; never edit an applied one, append a new version instead.
export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE site (
        id INTEGER PRIMARY KEY,
        origine TEXT NOT NULL UNIQUE,
        cree_le TEXT NOT NULL
      );
      CREATE TABLE marque (
        id INTEGER PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES site(id),
        nom TEXT NOT NULL,
        alias_json TEXT NOT NULL DEFAULT '[]',
        domaines_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE concurrent (
        id INTEGER PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES site(id),
        nom TEXT NOT NULL,
        alias_json TEXT NOT NULL DEFAULT '[]',
        domaines_json TEXT NOT NULL DEFAULT '[]',
        origine TEXT NOT NULL CHECK (origine IN ('declare', 'decouvert')),
        confirme INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE audit (
        id INTEGER PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES site(id),
        date TEXT NOT NULL,
        version_moteur TEXT NOT NULL,
        version_poids TEXT,
        resume_json TEXT NOT NULL,
        constats_json TEXT NOT NULL
      );
      CREATE TABLE jeu (
        id INTEGER PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES site(id),
        empreinte TEXT NOT NULL UNIQUE,
        version TEXT,
        langue TEXT,
        pays TEXT,
        niveau TEXT,
        graine INTEGER,
        cree_le TEXT NOT NULL
      );
      CREATE TABLE scenario (
        id INTEGER PRIMARY KEY,
        jeu_id INTEGER NOT NULL REFERENCES jeu(id),
        texte TEXT NOT NULL,
        profil TEXT,
        intention TEXT,
        poids REAL,
        avec_marque INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_audit_site ON audit(site_id, id);
      CREATE INDEX idx_scenario_jeu ON scenario(jeu_id);
    `,
  },
]

// Applies pending migrations, each in its own transaction (rolled back on failure).
export function appliquerMigrations(db, migrations = MIGRATIONS) {
  for (const m of migrations) {
    // IMMEDIATE takes the write lock up front; the version is re-checked inside it so concurrent processes cannot both apply it.
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('CREATE TABLE IF NOT EXISTS migration (version INTEGER PRIMARY KEY, appliquee_le TEXT NOT NULL)')
      if (db.prepare('SELECT 1 FROM migration WHERE version = ?').get(m.version)) {
        db.exec('COMMIT')
        continue
      }
      db.exec(m.sql)
      db.prepare('INSERT INTO migration(version, appliquee_le) VALUES (?, ?)').run(m.version, new Date().toISOString())
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* transaction already closed */ }
      throw new ErreurGeo(`Migration ${m.version} échouée : ${e.message}`)
    }
  }
}

export async function ouvrirBase(fichier = path.join(cheminDonnees(), 'geo.sqlite')) {
  silencerAvertissementSqlite()
  const { DatabaseSync } = await import('node:sqlite')
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  const db = new DatabaseSync(fichier)
  try {
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA foreign_keys=ON')
    appliquerMigrations(db)
  } catch (e) {
    db.close()
    throw e
  }

  const maintenant = () => new Date().toISOString()

  // Creates the site row on first sight of an origin.
  function idSite(origine) {
    if (typeof origine !== 'string' || !origine) throw new ErreurGeo("Origine du site manquante.")
    db.prepare('INSERT OR IGNORE INTO site(origine, cree_le) VALUES (?, ?)').run(origine, maintenant())
    return db.prepare('SELECT id FROM site WHERE origine = ?').get(origine).id
  }

  function dansTransaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      db.exec('COMMIT')
      return r
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* already closed */ }
      throw e
    }
  }

  return {
    enregistrerAudit({ origine, version_moteur, collecte_resume, constats, version_poids = null }) {
      return dansTransaction(() => {
        const site = idSite(origine)
        const r = db.prepare(
          'INSERT INTO audit(site_id, date, version_moteur, version_poids, resume_json, constats_json) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(site, maintenant(), version_moteur, version_poids, JSON.stringify(collecte_resume ?? {}), JSON.stringify(constats ?? []))
        return Number(r.lastInsertRowid)
      })
    },

    dernierAudit(origine) {
      const l = db.prepare(
        'SELECT a.* FROM audit a JOIN site s ON s.id = a.site_id WHERE s.origine = ? ORDER BY a.id DESC LIMIT 1'
      ).get(origine)
      if (!l) return null
      let resume, constats
      try {
        resume = JSON.parse(l.resume_json)
        constats = JSON.parse(l.constats_json)
      } catch {
        throw new ErreurGeo(`Audit ${l.id} illisible : JSON corrompu dans la base.`)
      }
      return { id: l.id, origine, date: l.date, version_moteur: l.version_moteur, version_poids: l.version_poids, resume, constats }
    },

    // Audit by numeric id (the id returned by enregistrerAudit); null when unknown.
    auditParId(id) {
      const n = Number(id)
      if (!Number.isInteger(n) || n < 1) return null
      const l = db.prepare('SELECT a.*, s.origine FROM audit a JOIN site s ON s.id = a.site_id WHERE a.id = ?').get(n)
      if (!l) return null
      let resume, constats
      try {
        resume = JSON.parse(l.resume_json)
        constats = JSON.parse(l.constats_json)
      } catch {
        throw new ErreurGeo(`Audit ${l.id} illisible : JSON corrompu dans la base.`)
      }
      return { id: l.id, origine: l.origine, date: l.date, version_moteur: l.version_moteur, version_poids: l.version_poids, resume, constats }
    },

    // Frozen scenario sets, oldest first, without their scenarios.
    listerJeux() {
      return db.prepare(
        'SELECT j.id, s.origine, j.empreinte, j.version, j.langue, j.pays, j.niveau, j.graine, j.cree_le, (SELECT COUNT(*) FROM scenario WHERE jeu_id = j.id) AS nb_scenarios FROM jeu j JOIN site s ON s.id = j.site_id ORDER BY j.id'
      ).all().map((l) => ({ ...l, nb_scenarios: Number(l.nb_scenarios) }))
    },

    enregistrerJeu(jeu) {
      const doublon = () => new ErreurGeo(`Un jeu d'empreinte ${jeu.empreinte} existe déjà.`)
      try {
        return dansTransaction(() => {
        if (db.prepare('SELECT 1 FROM jeu WHERE empreinte = ?').get(jeu.empreinte)) throw doublon()
        const site = idSite(jeu.origine)
        const r = db.prepare(
          'INSERT INTO jeu(site_id, empreinte, version, langue, pays, niveau, graine, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(site, jeu.empreinte, jeu.version ?? null, jeu.langue ?? null, jeu.pays ?? null, jeu.niveau ?? null, jeu.graine ?? null, maintenant())
        const id = Number(r.lastInsertRowid)
        const ins = db.prepare('INSERT INTO scenario(jeu_id, texte, profil, intention, poids, avec_marque) VALUES (?, ?, ?, ?, ?, ?)')
        for (const s of jeu.scenarios ?? []) {
          ins.run(id, s.texte, s.profil ?? null, s.intention ?? null, s.poids ?? null, s.avec_marque ? 1 : 0)
        }
        return id
        })
      } catch (e) {
        if (/UNIQUE constraint failed: jeu.empreinte/.test(e?.message ?? '')) throw doublon()
        throw e
      }
    },

    // Read-only PRAGMA lookup (e.g. 'foreign_keys'), used by tests to check connection settings.
    pragma(nom) {
      if (!/^[a-z_]+$/.test(nom)) throw new ErreurGeo('Nom de PRAGMA invalide.')
      return Object.values(db.prepare(`PRAGMA ${nom}`).get() ?? {})[0] ?? null
    },

    jeu(empreinte) {
      const l = db.prepare('SELECT j.*, s.origine FROM jeu j JOIN site s ON s.id = j.site_id WHERE j.empreinte = ?').get(empreinte)
      if (!l) return null
      const scenarios = db.prepare('SELECT texte, profil, intention, poids, avec_marque FROM scenario WHERE jeu_id = ? ORDER BY id').all(l.id)
        .map((s) => ({ ...s, avec_marque: s.avec_marque === 1 }))
      return { ...l, scenarios }
    },

    fermer() {
      db.close()
    },
  }
}
