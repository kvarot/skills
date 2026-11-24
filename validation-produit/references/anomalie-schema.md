# Anomalies, statuts et preuves

## `anomalies.json` (écrit par `consolider.mjs`, sans IA)

| Champ | Sens |
|---|---|
| `id` | `VP-` + 8 caractères : empreinte de la citation vérifiée (ou du texte) ; **stable** d'une campagne à l'autre tant que l'écran dit la même chose |
| `titre`, `resultat_observe` | ce que le persona ou le validateur a constaté |
| `statut` | `observé` (au moins une citation retrouvée dans ce que l'outil a vraiment montré, ou verdict du validateur) ou `hypothèse` |
| `sources` | `friction`, `incoherence`, `validateur` |
| `personas`, `frequence` | qui l'a vue, `n/total` exécutions |
| `gravite` | `bloquant` / `gênant` / `mineur` (max des personas) |
| `confiance` | `haute` (validateur, ou citation vérifiée par 2 personas ou plus), `moyenne` (1 citation vérifiée), `basse` |
| `etapes_reproduction` | actions réelles du journal qui ont mené à l'écran cité (libellés des éléments cliqués) |
| `preconditions`, `scenario` | instance neuve, parcours |
| `preuves`, `preuves_verifiees` | citations ; captures dans le dossier du persona |
| `impact_utilisateur` | ce que chaque persona en dit |
| `resultat_attendu`, `recommandation` | remplis par l'expert (attendu sourcé) et l'arbitre |
| `contre_expertise_requise` | vrai si bloquant ou confiance basse |

## Décisions de l'arbitre (`arbitrage.json`)

`confirmé` (preuve vérifiée + cohérent avec la vérité), `plausible` (preuve partielle), `rejeté` (erreur du persona, limite de l'outil, comportement voulu), `à_rejouer` (contre-expertise requise). Le type distingue **défaut produit**, **limite de l'outil**, **erreur du persona**, **comportement voulu**.

## Ce que chaque résultat est vraiment

| Étiquette | Sens |
|---|---|
| exécuté | une action a été faite dans un vrai navigateur, sur une vraie instance (journal) |
| constaté | un texte cité est retrouvé dans ce que le navigateur a renvoyé (`analyse.json`) |
| vérifié | le validateur a lu l'état réel du produit (`validation.json`) |
| reproduit | un rejoueur indépendant a refait les étapes et obtenu le même constat |
| déclaré | ce que le persona dit (objectif atteint, compréhension) : simulation |
| estimé | temps humain (modèle KLM ou estimation du persona), frustration |
| bloqué / non testé | l'outil a refusé, la limite a été atteinte, ou le point n'a pas été atteint |

Une correction n'est jamais validée par l'agent qui l'a proposée : nouveau passage + rejeu.

## Exports (brouillons locaux, jamais envoyés)

`exports/github/<id>.md` (un ticket par anomalie observée) et `exports/notion.md` (tableau). Les publier demande l'accord explicite du propriétaire.
