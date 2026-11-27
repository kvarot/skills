# Architecture (version 0.1.0)

## Arborescence

```
plugins/geo/
├── .claude-plugin/plugin.json
├── skills/            geo (point d'entrée), geo-technique, geo-contenu, geo-entites, geo-scenarios
├── agents/            lecteur-contenu.md (outil Read seul)
├── outils/
│   ├── geo.mjs        CLI unique : sous-commandes, JSON sur stdout
│   └── lib/           reseau, robots, extraire, collecter, controles, contenu, entites,
│                      scenarios, scores, base, rapports, idees, commandes, sortie
├── donnees/           robots.json, poids.json, idees-fausses.json, profils.json, intentions.json,
│                      gabarits/<langue>.json, langues/<langue>.json
├── references/        fiches lues à la demande par les skills (constats, scores, robots IA, entités…)
├── docs/exemples/     rapport d'exemple
└── evals/             tests (node --test), sites de référence fictifs, évaluation de déclenchement
```

Il n'y a pas de dossier `commands/` : **le seul point d'entrée est le skill `geo`**, qui interprète `/geo <sous-commande> [url]` (décision de conception, point 8 de la section « Points tranchés »).

## Principe

Le **code décide, le modèle interprète**. Tout chiffre (constat, score, couverture) sort de `geo.mjs`, de façon déterministe et rejouable ; le modèle de la session pose les questions, explique et résume, il ne calcule rien. Les skills sont des consignes courtes ; les faits (registre des robots, poids, fausses idées) sont des fichiers de données sourcés et datés.

## Flux d'un audit

1. `init` crée le dossier de données et vide la liste des hôtes autorisés.
2. L'utilisateur donne son accord pour les hôtes ; `autoriser` les inscrit dans `session.json`.
3. `auditer` : couche réseau gardée (`reseau.mjs`) → collecte polie (`collecter.mjs`, `robots.txt` du site respecté pour l'agent `geo-audit`) → extraction du HTML (`extraire.mjs`) → contrôles (`controles.mjs`), contenu (`contenu.mjs`), entités (`entites.mjs`) → scores (`scores.mjs`, poids de `donnees/poids.json`) → enregistrement dans SQLite.
4. `exporter-contenu` écrit les passages à juger dans `tmp/`, par lots ; l'agent `lecteur-contenu` les lit et renvoie un JSON ; la session le valide avant usage ; `--purger` vide `tmp/`.
5. `rapport` produit le Markdown ou le JSON à partir de la base.

## Stockage

Un dossier de données (`.claude/geo/` du dossier courant, ou `GEO_HOME`) : `session.json`, `geo.sqlite` (module `node:sqlite`, migrations versionnées), `cache/`, `tmp/`. Rien n'est écrit ailleurs. Voir [PRIVACY.md](PRIVACY.md).

## Sorties et données non fiables

Aucun texte de page brut n'arrive sur stdout : uniquement des faits, des identifiants et des extraits de 280 caractères au plus, échappés et marqués `non_fiable: true`. Voir [SECURITY.md](SECURITY.md).

## Réutilisation de `plugins/seo/`

Quatre modules d'outils (réseau, extraction HTML, robots, collecte) et le script d'évaluation de déclenchement sont adaptés de `plugins/seo/` (même auteur, licence MIT) ; l'origine est citée en tête de chaque fichier. Aucun code d'un tiers n'est copié ([THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)). Le plugin `geo` n'écrit jamais dans `.claude/seo/`.

## Ce que la 0.1 ne contient pas

Connecteurs d'API, extraction de mentions, statistiques, coûts, diagnostic, correction, expériences, logs : voir [ROADMAP.md](ROADMAP.md).
