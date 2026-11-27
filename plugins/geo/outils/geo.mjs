#!/usr/bin/env node
// geo plugin CLI: subcommand dispatcher. JSON on stdout, errors on stderr.
// Exit codes: 0 ok, 1 error, 2 finding threshold exceeded, 3 consent or budget missing.
import { ErreurGeo } from './lib/sortie.mjs'

const VERSION = '0.1.0'
const USAGE = `Usage : node geo.mjs <commande> [options]
  --version    affiche la version`

const commandes = new Map()
export function commande(nom, fn) {
  commandes.set(nom, fn)
}

async function main(argv) {
  const [nom, ...reste] = argv
  if (nom === '--version') {
    process.stdout.write(JSON.stringify({ version: VERSION }) + '\n')
    return
  }
  const fn = commandes.get(nom)
  if (!fn) {
    process.stderr.write(USAGE + '\n')
    process.exitCode = 1
    return
  }
  await fn(reste)
}

try {
  await main(process.argv.slice(2))
} catch (e) {
  process.stderr.write(`Erreur : ${e.message}\n`)
  process.exitCode = e instanceof ErreurGeo ? e.code : 1
}
