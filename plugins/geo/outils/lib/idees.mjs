// False-claims registry matching: motifs are applied per clause, so a negation elsewhere in the line cannot hide a claim.
import fs from 'node:fs'

export function chargerIdees() {
  return JSON.parse(fs.readFileSync(new URL('../../donnees/idees-fausses.json', import.meta.url), 'utf8')).idees
}

// Clauses: split on . ! ? ; : , and newlines. A dot inside a word (llms.txt) or after "no"/"n" before a digit
// ("no. 3") does not split. Splitting on commas lets a negation clause ("..., ne le manquez pas") stand apart.
export function clauses(texte) {
  return String(texte ?? '')
    .split(/(?<!\bno)\.(?=\s)|[!?;:,\n]+/i)
    .map((c) => c.trim())
    .filter(Boolean)
}

// Lines starting with "> Idée fausse :" may quote a claim in order to refute it. Returns "<id> : <clause>" findings.
export function trouverIdeesFausses(texte, idees = chargerIdees()) {
  const trouves = []
  for (const ligne of String(texte ?? '').split('\n')) {
    if (/^\s*>\s*Idée fausse :/.test(ligne)) continue
    for (const c of clauses(ligne)) {
      for (const i of idees) for (const m of i.motifs) if (new RegExp(m, 'iu').test(c)) trouves.push(`${i.id} : ${c.slice(0, 120)}`)
    }
  }
  return trouves
}
