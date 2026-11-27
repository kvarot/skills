// Subcommands of the geo CLI. geo.mjs imports this module and registers the handlers; nothing here imports geo.mjs.
// Exit codes: 0 ok, 1 error, 2 finding threshold exceeded, 3 consent or budget missing (ErreurGeo carries the code).
import fs from 'node:fs'
import path from 'node:path'
import { ErreurGeo, cheminDonnees, ecrireJson, extrait } from './sortie.mjs'
import { creerClient, hotesAutorises } from './reseau.mjs'
import { collecterUrl, collecterDossier } from './collecter.mjs'
import { evaluerRobotsIa } from './robots.mjs'
import { controler } from './controles.mjs'
import { analyserEntite } from './entites.mjs'
import { analyserContenu } from './contenu.mjs'
import { calculerScores, chargerPoids } from './scores.mjs'
import { genererScenarios, figerJeu } from './scenarios.mjs'
import { ouvrirBase } from './base.mjs'
import { rapportMarkdown, rapportJson, passagesComplets, resumerEntite, assainirConstat, PASSAGES_PAR_LOT } from './rapports.mjs'

export const VERSION = '0.1.0'
const HOTE_WIKIDATA = 'www.wikidata.org'

export const USAGE = `Usage : node geo.mjs <commande> [options]
  init                                       crée .claude/geo/, session.json et la base
  autoriser <hôte>[,<hôte>…]                 ajoute des hôtes à session.json
  auditer --url <u> | --dossier <d> [--max-pages n] [--marque <nom>] [--wikidata]
          [--autoriser-local] [--hotes-autorises h,…] [--echec-si bloquant|important]
  robots --url <u> [--autoriser-local] [--hotes-autorises h,…]
  scenarios generer --profil <fichier.json> --niveau <n> --graine <g>
  scenarios figer --profil <fichier.json> --niveau <n> --graine <g> --origine <url> [--pays <code>]
  scenarios lister
  scores --audit <id>
  rapport --audit <id> --format md|json [--sortie <fichier>]
  exporter-contenu --audit <id> --lot <n> | --purger
  --version                                  affiche la version`

// Strict option parser: `valeurs` take an argument, `drapeaux` do not; anything else is an error (code 1).
function options(args, { valeurs = [], drapeaux = [], positionnels = 0 } = {}) {
  const sortie = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) {
      if (sortie._.length >= positionnels) throw new ErreurGeo(`Argument inattendu « ${a} ».\n${USAGE}`)
      sortie._.push(a)
      continue
    }
    const nom = a.slice(2)
    if (drapeaux.includes(nom)) sortie[nom] = true
    else if (valeurs.includes(nom)) {
      const v = args[++i]
      if (v === undefined || v.startsWith('--')) throw new ErreurGeo(`L'option --${nom} attend une valeur.\n${USAGE}`)
      sortie[nom] = v
    } else throw new ErreurGeo(`Option inconnue « ${a} ».\n${USAGE}`)
  }
  return sortie
}

const liste = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const dossierDonnees = () => cheminDonnees()

function registre() {
  return JSON.parse(fs.readFileSync(new URL('../../donnees/robots.json', import.meta.url), 'utf8'))
}

function lireSession(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'))
    return { ...s, hotes_autorises: Array.isArray(s?.hotes_autorises) ? s.hotes_autorises : [] }
  } catch {
    return { hotes_autorises: [] }
  }
}

function ecrireSession(dir, session) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session, null, 2) + '\n')
}

// Network client bound to the allowlist (session.json + --hotes-autorises). Test-only pacing override needs --autoriser-local.
function clientReseau(opts) {
  const dir = dossierDonnees()
  const hotes = hotesAutorises(dir, liste(opts['hotes-autorises']))
  const autoriserLocal = opts['autoriser-local'] === true
  const delai = Number(process.env.GEO_DELAI_MS)
  const delaiMs = autoriserLocal && Number.isFinite(delai) && delai >= 0 ? delai : 1000
  return { client: creerClient({ hotes, autoriserLocal, delaiMs, cache: path.join(dir, 'cache') }), hotes }
}

// Resolves a path under the data directory; refuses anything that escapes it.
function sousDonnees(...parts) {
  const racine = path.resolve(dossierDonnees())
  const p = path.resolve(racine, ...parts)
  if (p !== racine && !p.startsWith(racine + path.sep)) throw new ErreurGeo(`Écriture refusée hors de ${racine}.`)
  return p
}

const tab = (a) => (Array.isArray(a) ? a : [])

// What the collector saw for robots.txt, as a closed vocabulary: present | absent | inaccessible | dossier-present | dossier-absent.
// RFC 9309: 4xx = no restriction; 5xx or network failure = everything is treated as disallowed.
function etatRobots(site) {
  const s = site ?? {}
  if (s.racine === null || s.racine === undefined) return { etat: typeof s.robotsTxt === 'string' ? 'dossier-present' : 'dossier-absent', statut: null }
  const statut = Number.isInteger(s.robotsStatut) ? s.robotsStatut : null
  if (statut === 0 || (statut !== null && statut >= 500)) return { etat: 'inaccessible', statut }
  if (typeof s.robotsTxt === 'string') return { etat: 'present', statut }
  return { etat: 'absent', statut }
}

// Files the data directory holds for the tool itself: never overwritten by --sortie.
const RESERVES = /^(session\.json|geo\.sqlite(-wal|-shm|-journal)?|cache|tmp)$/

function lireProfil(fichier) {
  if (!fichier) throw new ErreurGeo(`L'option --profil est obligatoire.\n${USAGE}`)
  let brut
  try { brut = fs.readFileSync(fichier, 'utf8') } catch { throw new ErreurGeo(`Profil illisible : ${fichier}`) }
  try { return JSON.parse(brut) } catch { throw new ErreurGeo(`Profil invalide (JSON attendu) : ${fichier}`) }
}

async function avecBase(fn) {
  const base = await ouvrirBase(path.join(dossierDonnees(), 'geo.sqlite'))
  try { return await fn(base) } finally { base.fermer() }
}

function exigerAudit(base, id) {
  if (!id) throw new ErreurGeo(`L'option --audit est obligatoire.\n${USAGE}`)
  const a = base.auditParId(id)
  if (!a) throw new ErreurGeo(`Audit introuvable : ${id}`)
  return a
}

// The record rapport and scores read back: everything the audit row holds, plus the id.
function reconstituer(a) {
  const r = a.resume ?? {}
  return {
    audit_id: a.id, origine: a.origine, constats: a.constats, scores: r.scores ?? [], robots_ia: r.robots_ia ?? [], robots_txt: r.robots_txt ?? {},
    contenu_resume: r.contenu_resume ?? { pages: [], passages: 0, constats: [] }, entite: r.entite ?? {},
    erreurs: r.erreurs ?? [], exploration: r.exploration ?? {},
  }
}

// Content findings are produced per page: merged by id so the report lists each once with its pages.
function fusionnerConstatsContenu(contenus) {
  const par = new Map()
  for (const c of contenus.flatMap((x) => x.constats)) {
    const { rang, ...reste } = c
    const e = par.get(c.id)
    if (e) e.pages = [...new Set([...e.pages, ...tab(c.pages)])].sort()
    else par.set(c.id, { ...reste, pages: [...tab(c.pages)] })
  }
  return [...par.values()]
}

const RANG = { bloquant: 0, important: 1, mineur: 2, information: 3 }

// --- commands ---------------------------------------------------------------

async function cmdInit(args) {
  options(args)
  const dir = dossierDonnees()
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(path.join(dir, 'session.json'))) ecrireSession(dir, { hotes_autorises: [] })
  await avecBase(() => {})
  ecrireJson({ dossier: dir, session: lireSession(dir) })
}

function cmdAutoriser(args) {
  const o = options(args, { positionnels: 1 })
  const hotes = liste(o._[0])
  if (!hotes.length) throw new ErreurGeo(`Indiquez au moins un hôte.\n${USAGE}`)
  const valides = hotes.map((h) => h.toLowerCase())
  for (const h of valides) if (!/^[a-z0-9.\-:[\]]+$/.test(h)) throw new ErreurGeo(`Nom d'hôte invalide : ${h}`)
  const dir = dossierDonnees()
  const session = lireSession(dir)
  session.hotes_autorises = [...new Set([...session.hotes_autorises.map((h) => String(h).toLowerCase()), ...valides])].sort()
  ecrireSession(dir, session)
  ecrireJson({ hotes_autorises: session.hotes_autorises })
}

async function cmdAuditer(args) {
  const o = options(args, { valeurs: ['url', 'dossier', 'max-pages', 'marque', 'echec-si', 'hotes-autorises'], drapeaux: ['wikidata', 'autoriser-local'] })
  if (!!o.url === !!o.dossier) throw new ErreurGeo(`Indiquez --url ou --dossier (un seul).\n${USAGE}`)
  const seuil = o['echec-si']
  if (seuil !== undefined && !['bloquant', 'important'].includes(seuil)) throw new ErreurGeo(`--echec-si attend « bloquant » ou « important ».\n${USAGE}`)
  const maxPages = o['max-pages'] === undefined ? 50 : Number(o['max-pages'])
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new ErreurGeo('--max-pages attend un entier positif.')

  const { client, hotes } = clientReseau(o)
  if (o.wikidata && !hotes.has(HOTE_WIKIDATA)) throw new ErreurGeo(`Hôte non autorisé : ${HOTE_WIKIDATA} (requis par --wikidata). Ajoutez-le avec « autoriser » ou --hotes-autorises.`, 3)

  let collecte, origine
  if (o.url) {
    try { new URL(o.url) } catch { throw new ErreurGeo(`URL invalide : ${o.url}`) }
    collecte = await collecterUrl(o.url, { client, maxPages })
    origine = collecte.site?.racine ?? new URL(o.url).origin
  } else {
    collecte = collecterDossier(path.resolve(o.dossier))
    origine = 'dossier:' + path.basename(path.resolve(o.dossier))
  }
  collecte = { ...collecte, origine: o.url ? origine : undefined }

  const reg = registre()
  const constatsTech = controler(collecte, reg)
  const entiteBrute = await analyserEntite(collecte, { marque: o.marque, client, wikidata: o.wikidata === true })
  const contenus = tab(collecte.pages).map((p) => analyserContenu(p))
  const poids = chargerPoids()
  const scores = calculerScores({ constats: constatsTech, contenu: contenus, entite: entiteBrute, pages: collecte.pages, collecte }, poids)

  const constats = [...constatsTech, ...tab(entiteBrute.constats).map(({ rang, ...c }) => c), ...fusionnerConstatsContenu(contenus)]
    .map(assainirConstat)
    .sort((a, b) => (RANG[a.severite] ?? 9) - (RANG[b.severite] ?? 9))

  const chemins = [...new Set(tab(collecte.pages).map((p) => { try { const u = new URL(p.url, 'http://x'); return u.pathname + u.search } catch { return null } }).filter(Boolean))].slice(0, 50)
  const robotsTxt = etatRobots(collecte.site)
  const tousChemins = ['/', ...chemins.filter((c) => c !== '/')]
  const robotsIa = evaluerRobotsIa(collecte.site?.robotsTxt ?? '', tousChemins, reg)
    .map((r) => ({ jeton: r.jeton, editeur: reg.robots.find((x) => x.jeton === r.jeton)?.editeur ?? null, role: r.role, documente: r.documente, chemins_bloques: robotsTxt.etat === 'inaccessible' ? tousChemins : r.chemins_bloques }))

  const contenuResume = {
    pages: contenus.map((c) => ({ url: c.url, langue: c.langue, prise_en_charge: c.prise_en_charge, sans_texte: c.sans_texte, passages: c.passages.length })),
    passages: contenus.reduce((n, c) => n + c.passages.length, 0),
    constats: fusionnerConstatsContenu(contenus).map((c) => ({ id: c.id, severite: c.severite, pages: tab(c.pages).length })),
  }
  const erreurs = tab(collecte.erreurs).map((e) => ({ url: extrait(e.url, 300).extrait, raison: extrait(e.raison, 300).extrait }))
  const exploration = { ...collecte.exploration, waf: !!collecte.site?.waf }
  const entite = resumerEntite(entiteBrute)

  const id = await avecBase((base) => base.enregistrerAudit({
    origine, version_moteur: VERSION, version_poids: poids.version, constats,
    collecte_resume: { scores, robots_ia: robotsIa, robots_txt: robotsTxt, contenu_resume: contenuResume, entite, erreurs, exploration },
  }))

  // Full passages for the read-only content agent: untrusted page text, purged by exporter-contenu --purger.
  const passages = tab(collecte.pages).flatMap((p, i) => passagesComplets(p, contenus[i]))
  const dirTmp = sousDonnees('tmp', `audit-${id}`)
  fs.mkdirSync(dirTmp, { recursive: true })
  fs.writeFileSync(path.join(dirTmp, 'passages.json'), JSON.stringify(passages, null, 2))

  ecrireJson({ audit_id: id, origine, constats, scores, robots_ia: robotsIa, robots_txt: robotsTxt, contenu_resume: contenuResume, entite, erreurs, exploration })

  if (seuil) {
    const bloquants = constats.filter((c) => c.severite === 'bloquant').length
    const importants = constats.filter((c) => c.severite === 'important').length
    if (bloquants || (seuil === 'important' && importants)) {
      process.stderr.write(`Seuil dépassé : ${bloquants} bloquant(s)${seuil === 'important' ? `, ${importants} important(s)` : ''}.\n`)
      process.exitCode = 2
    }
  }
}

async function cmdRobots(args) {
  const o = options(args, { valeurs: ['url', 'hotes-autorises'], drapeaux: ['autoriser-local'] })
  if (!o.url) throw new ErreurGeo(`L'option --url est obligatoire.\n${USAGE}`)
  let u
  try { u = new URL(o.url) } catch { throw new ErreurGeo(`URL invalide : ${o.url}`) }
  const { client } = clientReseau(o)
  const rep = await client.demander(u.origin + '/robots.txt', { accept: 'text/plain,*/*;q=0.1' })
  const ok = rep.statut >= 200 && rep.statut < 300 && typeof rep.corps === 'string'
  const reg = registre()
  const lignes = evaluerRobotsIa(ok ? rep.corps : '', ['/'], reg)
  const etat = etatRobots({ racine: u.origin, robotsStatut: rep.statut, robotsTxt: ok ? rep.corps : null })
  const tout = etat.etat === 'inaccessible'
  ecrireJson({
    origine: u.origin,
    robots_txt: { etat: etat.etat, statut: rep.statut, present: ok, ...(rep.raison ? { raison: extrait(rep.raison, 200).extrait } : {}) },
    robots: lignes.map((r) => ({
      jeton: r.jeton, editeur: reg.robots.find((x) => x.jeton === r.jeton)?.editeur ?? null, role: r.role, documente: r.documente,
      politique: tout ? 'inaccessible (exploration interdite par précaution)' : r.chemins_bloques.length ? 'bloqué' : 'autorisé',
      groupe: ['specifique', 'repli', 'etoile', 'aucun'].includes(r.groupe) ? r.groupe : 'aucun',
    })),
  })
}

async function cmdScenarios(args) {
  const [sous, ...reste] = args
  if (sous === 'lister') {
    options(reste)
    return avecBase((base) => ecrireJson({ jeux: base.listerJeux() }))
  }
  if (sous !== 'generer' && sous !== 'figer') throw new ErreurGeo(`Sous-commande de scenarios inconnue « ${sous ?? ''} ».\n${USAGE}`)
  const o = options(reste, { valeurs: ['profil', 'niveau', 'graine', ...(sous === 'figer' ? ['origine', 'pays'] : [])] })
  const profil = lireProfil(o.profil)
  const resultat = genererScenarios(profil, { niveau: o.niveau, graine: o.graine === undefined ? NaN : Number(o.graine) })
  if (sous === 'generer') return ecrireJson(resultat)
  const origine = o.origine ?? profil.origine
  if (!origine) throw new ErreurGeo(`L'option --origine est obligatoire pour figer un jeu.\n${USAGE}`)
  let nom
  try { nom = new URL(origine).origin } catch { throw new ErreurGeo(`Origine invalide : ${origine}`) }
  const jeuId = await avecBase((base) => figerJeu(base, nom, resultat, { langue: profil.langue ?? 'fr', pays: o.pays }))
  ecrireJson({ jeu_id: jeuId, origine: nom, empreinte: resultat.empreinte, niveau: resultat.niveau, graine: resultat.graine, scenarios: resultat.scenarios.length, manques: resultat.manques })
}

async function cmdScores(args) {
  const o = options(args, { valeurs: ['audit'] })
  const r = await avecBase((base) => reconstituer(exigerAudit(base, o.audit)))
  ecrireJson({ audit_id: r.audit_id, origine: r.origine, scores: r.scores })
}

async function cmdRapport(args) {
  const o = options(args, { valeurs: ['audit', 'format', 'sortie'] })
  const format = o.format ?? 'md'
  if (!['md', 'json'].includes(format)) throw new ErreurGeo(`--format attend « md » ou « json ».\n${USAGE}`)
  const audit = await avecBase((base) => reconstituer(exigerAudit(base, o.audit)))
  const texte = format === 'md' ? rapportMarkdown(audit) : rapportJson(audit)
  if (o.sortie) {
    const f = sousDonnees(o.sortie)
    const rel = path.relative(path.resolve(dossierDonnees()), f).split(path.sep)
    if (RESERVES.test(rel[0] ?? '')) throw new ErreurGeo(`--sortie ne peut pas écrire dans ${rel[0]} (fichier de l'outil).`)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, texte)
    ecrireJson({ fichier: f, format })
  } else {
    process.stdout.write(texte)
  }
}

async function cmdExporterContenu(args) {
  const o = options(args, { valeurs: ['audit', 'lot'], drapeaux: ['purger'] })
  const tmp = sousDonnees('tmp')
  if (o.purger) {
    fs.rmSync(tmp, { recursive: true, force: true })
    return ecrireJson({ purge: true })
  }
  const lot = Number(o.lot)
  if (!Number.isInteger(lot) || lot < 1) throw new ErreurGeo(`--lot attend un entier à partir de 1.\n${USAGE}`)
  await avecBase((base) => exigerAudit(base, o.audit))
  const source = sousDonnees('tmp', `audit-${Number(o.audit)}`, 'passages.json')
  let passages
  try { passages = JSON.parse(fs.readFileSync(source, 'utf8')) } catch { throw new ErreurGeo(`Passages de l'audit ${o.audit} indisponibles (purgés ou audit sans contenu).`) }
  const total = Math.max(1, Math.ceil(passages.length / PASSAGES_PAR_LOT))
  if (lot > total) throw new ErreurGeo(`Lot ${lot} inexistant : l'audit ${o.audit} compte ${total} lot(s).`)
  const dir = sousDonnees('tmp', `lot-${lot}`)
  fs.mkdirSync(dir, { recursive: true })
  const part = passages.slice((lot - 1) * PASSAGES_PAR_LOT, lot * PASSAGES_PAR_LOT)
  fs.writeFileSync(path.join(dir, 'passages.json'), JSON.stringify(part, null, 2))
  ecrireJson({ audit_id: Number(o.audit), lot, lots: total, passages: part.length, dossier: dir, non_fiable: true })
}

export function enregistrerCommandes(commande) {
  commande('init', cmdInit)
  commande('autoriser', cmdAutoriser)
  commande('auditer', cmdAuditer)
  commande('robots', cmdRobots)
  commande('scenarios', cmdScenarios)
  commande('scores', cmdScores)
  commande('rapport', cmdRapport)
  commande('exporter-contenu', cmdExporterContenu)
}
