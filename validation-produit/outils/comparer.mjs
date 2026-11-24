// Compares two consolidated passages (anomalies.json) of the same journey, e.g. two versions
// of the product or two versions of the skill. Ids are stable (hash of the verified quotation),
// so an anomaly seen again keeps its id. Deterministic, no AI.
//   node comparer.mjs <passage avant> <passage après> [--sortie comparaison.json]
// Output: nouvelles / persistantes / disparues, plus the measure deltas per persona.
// "disparue" is NOT "corrigée": it may only mean no persona reached that screen this time;
// the replay (contre-expertise) of the old steps decides.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const [av, ap] = process.argv.slice(2, 4).map((p) => path.resolve(p))
const so = process.argv.includes('--sortie') ? process.argv[process.argv.indexOf('--sortie') + 1] : path.join(ap, 'comparaison.json')
const lire = (d, f) => (existsSync(path.join(d, f)) ? JSON.parse(readFileSync(path.join(d, f), 'utf8')) : null)
const A = lire(av, 'anomalies.json') || []
const B = lire(ap, 'anomalies.json') || []
const SA = lire(av, 'synthese.json')
const SB = lire(ap, 'synthese.json')
const idsA = new Map(A.map((x) => [x.id, x]))
const idsB = new Map(B.map((x) => [x.id, x]))
const court = (x) => ({ id: x.id, titre: x.titre, gravite: x.gravite, frequence: x.frequence, confiance: x.confiance })
const moy = (S, k) => {
  if (!S) return null
  const v = S.personas.map((p) => (p.mesures || {})[k]).filter((x) => typeof x === 'number')
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null
}
const cles = ['interactions', 'retours_arriere', 'revisites', 'pages_aide_visitees', 'refus_garde', 'duree_technique_secondes']
const res = {
  avant: path.basename(path.dirname(av)) + '/' + path.basename(av),
  apres: path.basename(path.dirname(ap)) + '/' + path.basename(ap),
  nouvelles: B.filter((x) => !idsA.has(x.id)).map(court),
  persistantes: B.filter((x) => idsA.has(x.id)).map((x) => ({ ...court(x), frequence_avant: idsA.get(x.id).frequence })),
  disparues: A.filter((x) => !idsB.has(x.id)).map(court),
  avertissement: 'Une anomalie disparue n’est pas corrigée tant qu’un rejeu de ses étapes ne l’a pas confirmé.',
  mesures_moyennes: Object.fromEntries(cles.map((k) => [k, { avant: moy(SA, k), apres: moy(SB, k) }])),
  taux_reussite_declare: { avant: SA ? SA.taux_reussite_declare : null, apres: SB ? SB.taux_reussite_declare : null, avertissement: 'déclaré par des personas simulés' },
}
writeFileSync(so, JSON.stringify(res, null, 1))
console.log(JSON.stringify({ nouvelles: res.nouvelles.length, persistantes: res.persistantes.length, disparues: res.disparues.length }))
