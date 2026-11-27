# geo

Audit **GEO / AEO** d'un site web : ce que le site offre aux moteurs de réponse IA (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews…), avec des preuves rejouables. Plugin Claude Code, outils Node sans dépendance, licence MIT.

**Version 0.1.0.** Elle audite et diagnostique ; elle ne **mesure** encore aucune réponse d'assistant (voir « Non mesuré »).

## Installation

```
/plugin marketplace add kvarot/skills
/plugin install geo@kvarot-skills
```

Prérequis : **Node ≥ 22.13** (le module `node:sqlite` y est disponible sans option ; une version plus ancienne est refusée avec un message clair, code 1), aucune dépendance npm. Aucune clé d'API : la version 0.1 n'appelle aucun service payant.

## Utilisation

Le point d'entrée est le skill `geo` : décrivez votre besoin (« pourquoi ChatGPT recommande mes concurrents et pas moi ? », « fais un audit GEO de mon site ») ou tapez `/geo`. Si le skill ne se déclenche pas de lui-même, tapez `/geo` explicitement (voir « Limites »).

Au début de chaque session, `geo` :

1. initialise le dossier de données et efface l'accord réseau précédent ;
2. liste les hôtes qu'il va lire et demande **un accord explicite** pour la session ;
3. demande le niveau d'autonomie (1 analyse seule, 2 analyse et recommandations ; les niveaux 3 et 4, correctifs, sont prévus en 0.3).

Skills disponibles en 0.1 :

| Skill | Rôle |
|---|---|
| `geo` | point d'entrée : accord réseau, niveau, profil, audit, lecteur de contenu, rapport |
| `geo-technique` | accès des robots IA (`robots.txt`, WAF, rendu sans JavaScript), sitemaps, canonical, hreflang |
| `geo-contenu` | citabilité des passages, définitions, sources, auteur et date |
| `geo-entites` | identité de la marque : Organization, `sameAs`, cohérence du nom, Wikidata (facultatif) |
| `geo-scenarios` | jeu de requêtes reproductible (graine), figé et empreinté |

Sous-commandes de `/geo` disponibles en 0.1 : `audit`, `quick` (10 pages), `deep` (200 pages), `technical`, `content`, `report`, `cost`. Les autres (`visibility`, `citations`, `competitors`, `why-not`, `fix`, `verify`, `compare`, `history`, `monitor`, `logs`, `benchmark`) répondent « prévu en 0.2 » ou « prévu en 0.3 » et ne simulent rien.

### Outil en ligne de commande

Les skills appellent `outils/geo.mjs` ; vous pouvez l'utiliser seul. Sorties JSON sur stdout, erreurs sur stderr ; codes de sortie 0 (ok), 1 (erreur), 2 (seuil de constat dépassé avec `--echec-si`), 3 (accord réseau manquant).

```
node outils/geo.mjs init
node outils/geo.mjs autoriser www.example.org
node outils/geo.mjs auditer --url https://www.example.org [--marque <nom>] [--wikidata] [--max-pages n]
node outils/geo.mjs auditer --dossier <export-local>
node outils/geo.mjs robots --url https://www.example.org
node outils/geo.mjs scenarios generer|figer|lister ...
node outils/geo.mjs scores --audit <id>
node outils/geo.mjs rapport --audit <id> --format md|json [--sortie <fichier>]
node outils/geo.mjs exporter-contenu --audit <id> --lot <n> | --purger
```

Les fichiers sont écrits sous `.claude/geo/` du dossier courant (ou `GEO_HOME`) : voir [PRIVACY.md](PRIVACY.md).

## Mode gratuit

Tout ce que fait la version 0.1 est gratuit : audit, scénarios, scores, rapports. Aucun appel facturable n'existe ; `/geo cost` le confirme. Les appels payants (API des assistants) arriveront avec la mesure, en 0.2, et demanderont une estimation et un accord préalables.

## Ce que fait l'audit

- **Technique** : réponses HTTP, `noindex`, `robots.txt`, sitemap, canonical, hreflang, titres, données structurées JSON-LD, défi CDN / WAF, pages vides sans JavaScript.
- **Robots IA** : politique observée dans `robots.txt` pour chaque robot d'un registre sourcé (`donnees/robots.json`), séparée par rôle (indexation, consultation à la demande, entraînement, contrôle). Le plugin ne recommande jamais d'autoriser les robots d'entraînement.
- **Entités** : Organization / LocalBusiness / Product, `sameAs`, cohérence du nom et des coordonnées.
- **Contenu** (français et anglais) : définitions, chiffres, sources, passages autonomes, auteur, date ; un agent en lecture seule donne un avis qualitatif séparé des scores.
- **Scores de potentiel** sur 100, avec couverture et critères non calculés : voir [SCORING.md](SCORING.md).

## Non mesuré

Chaque plateforme (ChatGPT, Claude, Gemini, Perplexity, Copilot, Google AI Overviews, AI Mode, Grok, Mistral Le Chat, DeepSeek) est « non mesuré » en 0.1 : aucune requête n'est envoyée aux assistants, donc aucune visibilité, citation, part de voix ou position n'est donnée. Quatre scores (`autorite-thematique`, `reputation-externe`, `positionnement-concurrentiel`, `visibilite-mesuree`) valent `null`. Ce qui est « non mesuré » est écrit comme tel dans chaque rapport, jamais estimé. **Un score de potentiel élevé ne garantit aucune citation.** La mesure arrive en 0.2 ([ROADMAP.md](ROADMAP.md)).

## Exemple de rapport

[`docs/exemples/rapport-propre.md`](docs/exemples/rapport-propre.md) : sortie réelle de la 0.1 sur un site **fictif** de référence (`evals/sites/propre`), avec la commande qui la reproduit.

## Limites

- **Déclenchement automatique du skill** (évaluation `evals/resultats-declenchement-v0.1.json`, modèle haiku, formulations non vues pendant la rédaction) : demandes qui doivent déclencher un skill `geo*` : 15 sur 16 ; demandes qui ne doivent rien déclencher : 0 faux déclenchement sur 10 ; avec les plugins `geo` et `seo` installés ensemble : 4 sur 6 bien aiguillées. Les échecs sont toujours « aucun skill appelé », jamais un mauvais plugin. Dans ce cas, tapez `/geo`.
- **Aucune mesure** (0.2) ni diagnostic de cause, correction, expériences, historique comparatif, logs (0.3) : tout cela est « non mesuré » ou « prévu ».
- **Heuristiques de contenu : français et anglais seulement.** Une page dans une autre langue n'est pas jugée ; la couverture du score baisse et la page est signalée.
- **Isolation du lecteur de contenu** : le texte des pages est lu par un agent sans Bash, écriture ni réseau, mais la session principale pourrait techniquement lire les fichiers exportés ; le skill le lui interdit (limite assumée, détaillée dans [SECURITY.md](SECURITY.md)).
- **Détection des fausses idées par expressions régulières** : le contrôle qui empêche les documents du plugin de reprendre une affirmation réfutée (`donnees/idees-fausses.json`) raisonne par phrase, avec la négation avant la fin du motif ; il ne comprend pas le sens et peut manquer une reformulation.
- Les contrôles portent sur le HTML reçu, sans exécuter de JavaScript.
- Chaque audit relit le site (cache en mémoire le temps d'une commande seulement) : un audit relancé voit l'état actuel du site.
- **Wikidata** : une entrée n'est reconnue comme celle de l'entité que si son site officiel (P856) est sur l'hôte audité ; un libellé identique seul est signalé « identité non vérifiée » et n'est pas crédité.
- Le plugin ne prédit aucune citation ; les études sur l'effet de telle ou telle pratique sont partielles et contestées ([BENCHMARK.md](BENCHMARK.md)).

## Évaluation

```
node --test "plugins/geo/evals/tests/*.test.mjs"
```

Aucun test ne sort sur Internet. Les sites de référence à défauts semés (`evals/sites/`, tous fictifs) mesurent rappel et faux positifs (`evals/resultats-sites-v0.1.json`). Le chiffre de faux positifs (0) est mesuré sur les listes `interdits` et `absents` des **7 sites de référence**, écrites en même temps que les règles : il montre que ces cas connus ne se déclenchent pas, il ne se généralise pas à des sites réels. L'évaluation de déclenchement (`evals/eval-declenchement.mjs`) lance `claude -p` et n'est pas dans la suite.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [METHODOLOGY.md](METHODOLOGY.md) · [SCORING.md](SCORING.md) · [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [ROADMAP.md](ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md) · [BENCHMARK.md](BENCHMARK.md) · [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

Licence : MIT ([LICENSE](LICENSE)).
