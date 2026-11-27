// False-claims registry matching. Scope = sentence; a motif match is suppressed when a negation token
// stands in the same sentence before the END of the match (so "llms.txt n'améliore pas" is a refutation, while
// "... visibilité de 40 %, ne le manquez pas" is a claim followed by an unrelated negation).
import fs from 'node:fs'

export function chargerIdees() {
  return JSON.parse(fs.readFileSync(new URL('../../donnees/idees-fausses.json', import.meta.url), 'utf8')).idees
}

// French and English negation tokens; "no." or "no" followed by a digit ("no. 3") is a number sign, not a negation.
const NEGATION = /\b(pas|aucune?|ni|sans|jamais|nullement|ne|not|no(?!\.? ?\d)|never|nor|without|cannot)\b|\bn['’]|n['’]t\b/iu

// Sentences: split on . ! ? ; and newlines. A dot inside a word (llms.txt) or after "no" before a number does not split.
export function phrases(texte) {
  return String(texte ?? '')
    .split(/(?<!\bno)\.(?=\s)|[!?;\n]+/i)
    .map((c) => c.trim())
    .filter(Boolean)
}

// Lines starting with "> Idée fausse :" may quote a claim in order to refute it. Returns "<id> : <sentence>" findings.
export function trouverIdeesFausses(texte, idees = chargerIdees()) {
  const trouves = []
  for (const ligne of String(texte ?? '').split('\n')) {
    if (/^\s*>\s*Idée fausse :/.test(ligne)) continue
    for (const p of phrases(ligne)) {
      for (const i of idees) {
        const touche = i.motifs.some((m) => {
          const r = new RegExp(m, 'iu').exec(p)
          return r !== null && !NEGATION.test(p.slice(0, r.index + r[0].length))
        })
        if (touche) trouves.push(`${i.id} : ${p.slice(0, 120)}`)
      }
    }
  }
  return trouves
}
