#!/usr/bin/env node
// geo plugin CLI: subcommand dispatcher. JSON on stdout, errors on stderr.
// Exit codes: 0 ok, 1 error, 2 finding threshold exceeded, 3 consent or budget missing.
// The Node version is checked before the command modules load (node:sqlite needs no flag from 22.13 on).
import { ErreurGeo, NODE_MINIMUM, versionNodeSuffisante } from './lib/sortie.mjs'

const commandes = new Map()
export function commande(nom, fn) {
  commandes.set(nom, fn)
}

async function main(argv) {
  if (!versionNodeSuffisante(process.env.GEO_TEST_VERSION_NODE || process.versions.node)) {
    throw new ErreurGeo(`Node ${NODE_MINIMUM} ou plus est requis (version actuelle : ${process.env.GEO_TEST_VERSION_NODE || process.versions.node}) : le module node:sqlite n'est disponible sans option qu'à partir de cette version. Mettez Node à jour.`, 1)
  }
  const { enregistrerCommandes, USAGE, VERSION } = await import('./lib/commandes.mjs')
  enregistrerCommandes(commande)
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
