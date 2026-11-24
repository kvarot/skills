# Évaluer la skill elle-même

Inspiré de `anthropics/skills` / skill-creator (Apache-2.0, idées et formats, code réécrit) et de `obra/superpowers` (MIT, principe du témoin sans consigne).

## 1. Déclenchement — `evals/declenchement.json`, `evals/eval-declenchement.mjs`

20 requêtes (10 doivent déclencher, 10 voisines ne doivent pas). Chaque requête : `claude -p` depuis un dossier vide, seul l'outil Skill offert, arrêt au premier appel d'outil. Sortie : `evals/resultats-declenchement.json` (rappel, faux déclenchements). Relancer après toute modification de la description ; `--runs 3` pour mesurer la variance.

## 2. Détection — corpus à défauts connus

Un corpus = un produit jetable + un passage **propre** + un passage **semé** (au moins : un défaut fonctionnel, un défaut UX, un faux succès). Mesures, par version de la skill :

| Mesure | Source | Cible |
|---|---|---|
| Défauts semés détectés (par le validateur / par au moins un persona) | `validation.json`, `anomalies.json` du passage semé | 3/3 et ≥ 2/3 |
| Fausses alertes sur le passage propre | verdicts « faux » non reproduits | 0 |
| Citations retrouvées dans ce que l'outil a montré | `analyse.json` | ≥ 0,95 |
| Stabilité (même constat dans les 2 essais d'un persona) | `anomalies.json` (`frequence`) | à suivre |
| Coût et durée | `campagne.json` | à suivre |

## 3. Groupe témoin

La fiche `evals/temoin.md` (`role: temoin`) lance un agent **sans** règles ni personnage, avec la même isolation : on compare ce qu'il trouve et ce qu'il rate. Comparer aussi l'ancienne version de la skill (copie avant modification) et la nouvelle, sur le même commit du produit.

## 4. Lire avant de croire

Lire à la main chaque correspondance signalée (un modèle peut recopier le gabarit), et tout « faux » sur le passage propre est rejoué avant d'être compté.
