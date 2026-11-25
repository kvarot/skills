#!/usr/bin/env node
// seo plugin CLI: small subcommand dispatcher. JSON on stdout, errors on stderr.
import { parseArgs } from 'node:util'
import { collecterDossier, collecterUrl } from './collecter.mjs'
import { controler } from './controler.mjs'

const USAGE = `Usage : node seo.mjs <commande> [options]
  auditer --dossier <d> | --url <u> [--max-pages n] [--delai-ms n] [--autoriser-prod]`

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

const commandes = { auditer }
const [cmd, ...reste] = process.argv.slice(2)
if (!Object.hasOwn(commandes, cmd)) { console.error(USAGE); process.exit(2) }
try { await commandes[cmd](reste) } catch (e) {
  console.error('Erreur : ' + e.message + (e.usage || e.code?.startsWith?.('ERR_PARSE_ARGS') ? '\n' + USAGE : ''))
  process.exit(e.usage || e.code?.startsWith?.('ERR_PARSE_ARGS') ? 2 : 1)
}
