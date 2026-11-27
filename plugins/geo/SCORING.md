# Méthode de calcul des scores (version des poids 0.1.0)

Dix scores sur 100, indépendants. Six sont des scores de **potentiel** calculés à partir de l'audit ; quatre exigent une mesure sur des réponses réelles et valent `null` en v0.1. Les poids sont dans `donnees/poids.json` (version `0.1.0`) : deux exécutions de versions de poids différentes ne se comparent pas.

## Ce que ces scores ne disent pas

- Un score de potentiel mesure l'état du site au regard de critères documentés ; **un score de potentiel élevé ne garantit aucune citation**. Aucun score n'est une prédiction.
- **Les poids sont une convention de cette version, pas le résultat d'une mesure de citations.** Ils expriment un ordre de gravité (ce qui bloque tout > ce qui dégrade > ce qui complète), rien de plus. Les justifier par des citations observées exigerait une mesure que la v0.1 ne fait pas.
- Un score de potentiel et la visibilité mesurée ne s'additionnent jamais.

## Formule

Chaque critère a un poids et un `acquis` entre 0 et 1, ou `null` s'il n'est pas calculable.

- `valeur = arrondi(100 × Σ(poids × part × acquis) / Σ(poids × part) des critères calculés)` ; le quotient est d'abord arrondi à 6 décimales pour écarter le bruit flottant, puis l'arrondi usuel s'applique.
- `couverture = Σ(poids × part) des critères calculés / Σ poids de tous les critères` (arrondie à 4 décimales). `part` vaut 1, sauf pour les critères de contenu (voir « Langues »).
- Un critère non calculable vaut **absent**, jamais 0 : il sort du dénominateur et fait baisser la couverture.
- Si `couverture < 0,5`, `valeur` vaut `null` et `raison` l'explique.
- Chaque critère porte sa `classe` (`deterministe` ou `heuristique`) et une `preuve` qui nomme les constats et les nombres de pages utilisés. Aucun critère de classe `jugement` en v0.1.

## Règles de critère

- **Critère « absence d'un constat »** : `acquis = 1 − pages touchées / pages`. Les pages comptées sont les pages collectées ; pour les critères de contenu, les pages dont la langue est prise en charge et qui ont au moins un passage.
- **Constat de site** (sans liste de pages, par exemple `GEO-SITEMAP-ABSENT` ou `GEO-ROBOTSTXT-BLOQUE-TOUT`) : il touche toutes les pages, donc `acquis = 0`, **quel que soit le nombre de pages collectées, même zéro**. Un `Disallow: /` ne produit aucune page : le critère vaut 0, il n'est pas « non calculé ». Dans ce cas seulement (zéro page et `GEO-ROBOTSTXT-BLOQUE-TOUT`), `html-lisible` vaut 0 aussi : aucune page n'est lisible par un robot.
- **Pages comptées** : les critères par page ne comptent que les URL touchées qui sont des **pages collectées** (comparaison après normalisation d'URL, comme le collecteur). Si un constat est présent mais ne touche que des URL hors pages collectées, il compte pour une page, jamais pour zéro.
- **Critères fondés sur des URL** (`reponses-http`, `sitemap-coherent`, `pages-non-orphelines`, `pas-de-defi-waf`) : le dénominateur est l'ensemble des **URL connues** de l'audit (pages collectées, URL en erreur, URL du sitemap, URL défiées), et la preuve l'écrit (« n URL sur m URL connues »). Entrée optionnelle `collecte` pour fournir erreurs et sitemap ; sans elle, les URL connues sont les pages et les URL des constats. Avec zéro page collectée, un défi WAF donne 0 avec la preuve « défi WAF : aucune page analysable ».
- **Pages d'article** : `auteur-declare` et `date-presente` ne comptent que les pages d'article ou de documentation (même règle que `GEO-DATE-ABSENTE`, fonction `estPageArticle` de `controles.mjs`) ; sans une telle page, le critère est non calculé, pas à 0. Pour `auteur-declare`, les pages d'article en langue non prise en charge (ou sans passage) sont ignorées : ni acquises ni touchées.
- **Rattachement des constats de contenu** : chaque résultat de `analyserContenu` porte l'`url` de sa page ; les constats de contenu sont rapportés à ces URL (normalisées) et filtrés aux pages collectées. Une URL collectée mais écartée par un filtre (article, langue) ne compte pas ; seule une URL réellement hors pages collectées compte pour une page.
- **Critères d'entité** : binaires (cause présente → 0, absente → 1), sauf `produits-balises` qui compte des pages.
- **Une cause racine pèse une fois par score** : les constats qui partagent une cause forment un seul critère, acquis seulement si aucun n'est présent (les pages touchées sont réunies). Regroupement v0.1 : `GEO-ROBOTSTXT-BLOQUE-TOUT` + `GEO-ROBOTS-RECHERCHE-BLOQUE` → critère `recherche-non-bloquee` de `acces-ia` (« les robots de recherche ne peuvent pas lire le site »). Quand `GEO-ROBOTSTXT-BLOQUE-TOUT` est présent, `consultation-non-bloquee` est **non calculé** (« même cause que recherche-non-bloquee (robots.txt bloque tout) ») : le même `Disallow: /` ne pèse qu'une fois. Dans `seo-technique`, `GEO-ROBOTSTXT-BLOQUE-TOUT` a son propre critère `robots-txt-ouvert` (il bloque aussi les moteurs classiques) ; il ne compte qu'une fois dans ce score.
- **Langues** : les critères de contenu ne regardent que les pages en langue prise en charge (français ou anglais) ayant au moins un passage. Chacun contribue à la couverture pour `poids × part`, avec `part = pages dont la langue analysée est prise en charge / pages analysées` (son poids entier reste au dénominateur) ; la valeur le pondère de la même façon. Une page prise en charge sans passage compte comme prise en charge ; une page sans aucun texte visible est exclue du numérateur et du dénominateur ; un site entièrement en français garde donc `part = 1`. Sur 1 page française et 49 allemandes, `part = 0,02` : la couverture du score de contenu tombe à 0,02 et la valeur est `null`. La preuve indique le nombre de pages en langue non prise en charge, seulement s'il y en a. Aucun constat ni jugement n'est inventé.
- **Sans page collectée** : tous les critères issus de pages sont non calculés.
- Les constats de sévérité `information` n'affectent jamais un score. `GEO-LLMSTXT` et `GEO-CONTENT-SIGNAL` n'ont **aucun critère** (poids 0, jamais présentés comme un levier) ; `GEO-ROBOTS-ENTRAINEMENT-POLITIQUE` (politique observée, aucune recommandation) et `GEO-ENTITE-WIKIDATA-AMBIGU` (homonymie à désambiguïser par le propriétaire) n'ont pas de critère non plus.
- **Constats bloquants ou importants sans critère** : aucun. Un test vérifie que chacun est lu par au moins un critère.

## seo-technique (déterministe)

| Critère | Poids | Constat | Justification du poids |
|---|---|---|---|
| `indexable` | 20 | `GEO-NOINDEX` | une page exclue de l'index n'existe pas pour les moteurs |
| `robots-txt-ouvert` | 15 | `GEO-ROBOTSTXT-BLOQUE-TOUT` | interdiction totale : même effet que l'absence du site |
| `reponses-http` | 12 | `GEO-HTTP-ERREUR` | une page en erreur ne peut être ni lue ni citée |
| `titre-present` | 10 | `GEO-TITLE-ABSENT` | le title est le premier signal d'identification d'une page |
| `canonical-meme-hote` | 8 | `GEO-CANONICAL-AUTRE-HOTE` | cède l'autorité de la page à un autre site |
| `contenu-unique` | 8 | `GEO-CONTENU-DUPLIQUE` | dilue les signaux entre plusieurs URL |
| `h1-present` | 6 | `GEO-H1-ABSENT` | structure de base du document |
| `titres-uniques` | 6 | `GEO-TITLE-DOUBLON` | pages indiscernables dans les résultats |
| `langue-declaree` | 5 | `GEO-LANG-ABSENT` | sert à l'appariement langue-requête |
| `sitemap-present` | 5 | `GEO-SITEMAP-ABSENT` | aide à la découverte, sans bloquer l'exploration |
| `donnees-structurees-valides` | 5 | `GEO-JSONLD-INVALIDE` | un JSON-LD illisible est ignoré |
| `hreflang-reciproque` | 4 | `GEO-HREFLANG-RECIPROQUE` | un hreflang non réciproque est ignoré |
| `canonical-present` | 3 | `GEO-CANONICAL-ABSENT` | confort, les moteurs devinent souvent |
| `description-presente` | 3 | `GEO-DESC-ABSENT` | impact limité sur la sélection |
| `alt-presents` | 2 | `GEO-ALT-ABSENT` | accessibilité et contexte des images |
| `viewport-present` | 2 | `GEO-VIEWPORT-ABSENT` | confort mobile |
| `redirections-courtes` | 2 | `GEO-REDIRECTION-CHAINE` | ralentit l'exploration sans la bloquer |
| `profondeur-faible` | 2 | `GEO-PROFONDEUR` | profondeur = découverte plus lente |
| `pages-non-orphelines` | 2 | `GEO-PAGE-ORPHELINE` | découverte par le sitemap seulement |
| `sitemap-coherent` | 2 | `GEO-SITEMAP-INCOHERENT` | bruit, sans blocage |
| `hn-sans-saut` | 1 | `GEO-HN-SAUT` | détail de hiérarchie |
| `hreflang-xdefault` | 1 | `GEO-HREFLANG-XDEFAULT` | recommandation secondaire |

## acces-ia (déterministe)

| Critère | Poids | Constat(s) | Justification du poids |
|---|---|---|---|
| `recherche-non-bloquee` | 30 | `GEO-ROBOTSTXT-BLOQUE-TOUT` + `GEO-ROBOTS-RECHERCHE-BLOQUE` (une seule cause) | sans accès des robots de recherche, aucune citation n'est possible |
| `pas-de-defi-waf` | 25 | `GEO-WAF-DEFI` | un défi CDN ferme l'accès automatisé, pages non analysables |
| `html-lisible` | 25 | `GEO-HTML-VIDE` | les robots n'exécutent pas toujours le JavaScript : une coquille vide n'a rien à citer |
| `consultation-non-bloquee` | 20 | `GEO-ROBOTS-CONSULTATION-BLOQUE` | bloque la lecture à la demande de l'utilisateur, moins que la recherche |

Les robots d'entraînement n'entrent dans aucun critère : ce plugin ne recommande jamais de les autoriser.

## qualite-semantique (heuristique, langues prises en charge)

| Critère | Poids | Source | Justification du poids |
|---|---|---|---|
| `definition-presente` | 25 | `GEO-CONTENU-AUCUNE-DEFINITION` | un passage qui définit son sujet se suffit à lui-même |
| `sources-citees` | 25 | `GEO-CONTENU-SANS-SOURCE` | une affirmation sourcée est vérifiable |
| `passages-autonomes` | 25 | `GEO-CONTENU-PASSAGES-DEPENDANTS` | un passage qui renvoie au précédent ne se cite pas seul |
| `chiffres-presents` | 15 | part des pages avec un passage chiffré | indice de précision, hypothèse non confirmée |
| `structure-presente` | 10 | part des pages avec une liste ou un tableau | indice de lisibilité, hypothèse non confirmée |

## potentiel-citation (déterministe et heuristique)

| Critère | Poids | Source | Justification du poids |
|---|---|---|---|
| `extraits-autorises` | 30 | `GEO-NOSNIPPET` | sans extrait autorisé, rien ne peut être repris |
| `passages-citables` | 30 | part des passages remplissant au moins 3 des 6 critères de passage (heuristique) | seuil de convention de cette version |
| `auteur-declare` | 15 | `GEO-CONTENU-AUTEUR-ABSENT` | attribution du contenu |
| `date-presente` | 15 | `GEO-DATE-ABSENTE` | fraîcheur vérifiable (pages d'article ou de documentation) |
| `avis-visibles` | 10 | `GEO-JSONLD-AVIS-NON-VISIBLES` | cohérence entre balisage et texte visible |

Les critères fondés sur le contenu (`passages-citables`, `auteur-declare`) ne comptent que les pages en langue prise en charge.

## identite-numerique (déterministe, un critère heuristique)

| Critère | Poids | Source | Justification du poids |
|---|---|---|---|
| `organisation-declaree` | 25 | `GEO-ENTITE-SANS-ORGANIZATION` | base de l'identification de l'entité |
| `nom-coherent` | 20 | `GEO-ENTITE-NOM-INCOHERENT` | un nom écrit de plusieurs façons brouille l'entité |
| `coordonnees-coherentes` | 20 | `GEO-ENTITE-COORDONNEES-CONTRADICTOIRES` | contradictions de téléphone ou d'adresse |
| `sameas-present` | 15 | `GEO-ENTITE-SAMEAS-ABSENT` | liens vers les profils officiels ; non calculé sans organisation déclarée (déjà comptée) |
| `wikidata` | 10 | `entite.wikidata.statut` | `trouve` = 1 ; `absent`, `ambigu` ou non vérifié = non calculé (l'absence est normale pour une petite structure et n'est pas pénalisée : la vérification facultative ne peut jamais faire baisser le score) |
| `produits-balises` | 10 | `GEO-ENTITE-PRODUIT-SANS-SCHEMA` (heuristique) | comptage de pages, règle étroite |

La vérification Wikidata étant facultative, sans vérification Wikidata (option), la couverture de ce score est au plus de 0,9 ; les vérifications manuelles restent listées dans le rapport.

## couverture-intentions (heuristique)

| Critère | Poids | Source | Justification du poids |
|---|---|---|---|
| `intentions-couvertes` | 100 | jeu de scénarios et pages | critère unique |

`acquis` = part des intentions du jeu pour lesquelles au moins une page a un `h1` ou un `title` qui partage au moins 2 mots non vides (3 lettres ou plus, hors mots vides, normalisés sans accents ni casse) avec un scénario de cette intention. Sans jeu de scénarios, le critère n'est pas calculé.

## Scores mesurés (v0.2)

`autorite-thematique`, `reputation-externe`, `positionnement-concurrentiel` et `visibilite-mesuree` : `valeur: null`, `couverture: 0`, `raison: « nécessite une mesure (v0.2) »`. Aucune valeur n'est estimée à partir de l'audit.
