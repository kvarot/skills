#!/usr/bin/env node
// seo plugin CLI: small subcommand dispatcher. JSON on stdout, errors on stderr.
import { parseArgs } from 'node:util'
import { collecterDossier, collecterUrl } from './collecter.mjs'
import { controler } from './controler.mjs'
import { detecter } from './detecter.mjs'
import { lireProfil, validerProfil } from './profil.mjs'

const USAGE = `Usage : node seo.mjs <commande> [options]
  auditer --dossier <d> | --url <u> [--max-pages n] [--delai-ms n] [--autoriser-prod]
  detecter <dossier>
  profil-valider <fichier>`

const entier = (v, nom) => {
  if (v === undefined) return undefined
  if (!/^\d+$/.test(v)) throw new Error(`${nom} attend un entier positif ou nul (reçu « ${v} »)`)
  return Number(v)
}

async function auditer(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { dossier: { type: 'string' }, url: { type: 'string' }, 'max-pages': { type: 'string' }, 'delai-ms': { type: 'string' }, 'autoriser-prod': { type: 'boolean' } },
  })
  if (!values.dossier === !values.url) throw Object.assign(new Error('Indiquer exactement une cible : --dossier <d> ou --url <u>'), { usage: true })
  let collecte
  if (values.dossier) collecte = collecterDossier(values.dossier)
  else {
    const opts = { autoriserProd: !!values['autoriser-prod'] }
    const m = entier(values['max-pages'], '--max-pages'), d = entier(values['delai-ms'], '--delai-ms')
    if (m !== undefined) opts.maxPages = m
    if (d !== undefined) opts.delaiMs = d
    collecte = await collecterUrl(values.url, opts)
  }
  process.stdout.write(JSON.stringify({ stack: null, constats: controler(collecte.pages, collecte.site) }, null, 2) + '\n')
}

function detecterStack(argv) {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} })
  if (positionals.length !== 1) throw Object.assign(new Error('Indiquer le dossier à analyser : detecter <dossier>'), { usage: true })
  process.stdout.write(JSON.stringify(detecter(positionals[0]), null, 2) + '\n')
}

function profilValider(argv) {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} })
  if (positionals.length !== 1) throw Object.assign(new Error('Indiquer le fichier à valider : profil-valider <fichier>'), { usage: true })
  let meta
  try { meta = lireProfil(positionals[0]).meta } catch (e) {
    if (e.code) throw e // unreadable file: error on stderr, no verdict
    process.stdout.write(JSON.stringify({ valide: false, erreurs: ['front matter illisible : ' + e.message] }, null, 2) + '\n')
    process.exit(1)
  }
  const erreurs = validerProfil(meta)
  process.stdout.write(JSON.stringify({ valide: erreurs.length === 0, erreurs }, null, 2) + '\n')
  if (erreurs.length) process.exit(1)
}

const commandes = { auditer, detecter: detecterStack, 'profil-valider': profilValider }
const [cmd, ...reste] = process.argv.slice(2)
if (!Object.hasOwn(commandes, cmd)) { console.error(USAGE); process.exit(2) }
try { await commandes[cmd](reste) } catch (e) {
  console.error('Erreur : ' + e.message + (e.usage || e.code?.startsWith?.('ERR_PARSE_ARGS') ? '\n' + USAGE : ''))
  process.exit(e.usage || e.code?.startsWith?.('ERR_PARSE_ARGS') ? 2 : 1)
}
