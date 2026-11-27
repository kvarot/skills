# Méthodologie (version 0.1.0)

## Ce que l'audit affirme, et ce qu'il n'affirme pas

L'audit établit des **faits vérifiables sur le site** (réponses HTTP, règles de `robots.txt`, balises, données structurées, texte des pages) et en tire des constats et des scores de **potentiel**. Il n'établit pas ce que disent les assistants : cela exige une mesure sur des réponses réelles, absente en 0.1. Un site peut avoir tous les critères réunis sans être cité ; les études publiées sur l'effet des pratiques sont partielles, parfois contradictoires et surtout menées sur des moteurs simulés ([BENCHMARK.md](BENCHMARK.md)). Les consignes officielles de Google disent qu'optimiser pour la recherche générative reste du SEO : être exploré, indexé et lisible.

## Classes de preuve

Chaque constat et chaque critère de score porte une classe :

- **déterministe** : une règle exacte sur un fait observé (statut HTTP, `noindex`, verdict `robots.txt` selon la RFC 9309). Rejouable à l'identique.
- **heuristique** : un motif ou un seuil de convention (par exemple « le passage commence par une définition »). Rejouable, mais peut se tromper ; limité au français et à l'anglais.
- **jugement** : avis qualitatif du lecteur de contenu (modèle). Jamais dans un score, toujours affiché à part.

Chaque constat a une **preuve reproductible** : `{ type, url, detail }` où `type` ∈ `http`, `robots`, `html`, `jsonld`, `sitemap`, `calcul`, et `detail` la commande ou la valeur qui la redonne.

## Collecte

Exploration en largeur du même hôte, polie (1 s entre requêtes, `robots.txt` respecté), bornée par `--max-pages` ; la couverture est annoncée (pages lues, exploration incomplète si la limite est atteinte, erreurs listées). Le HTML est lu **sans exécuter de JavaScript** : ce que voit un robot qui n'exécute pas le script. Un défi CDN ou WAF (403 / 503 de défi, `cf-mitigated: challenge`) est signalé comme tel : la page n'est pas analysée comme contenu et n'est pas comptée « page vide ».

## Robots IA

Le registre `donnees/robots.json` dérive des documentations officielles des éditeurs (jeton, rôle, respect de `robots.txt`, source, date de vérification). Les rôles sont séparés : indexation (recherche), consultation à la demande de l'utilisateur, entraînement, contrôle. Le verdict par robot applique la RFC 9309 (groupes fusionnés, plus long motif, casse des jetons). Les jetons sans documentation officielle sont marqués « non documenté ». Un robot de consultation peut ne pas appliquer `robots.txt` : le verdict décrit la politique déclarée, pas le comportement garanti. La politique d'entraînement est décrite sans recommandation.

## Contenu

Le texte visible est découpé en passages (un titre et ses blocs). Six critères booléens par passage (définition, chiffre, source citée, autonomie, titre en question, structure) : ils décrivent la facilité d'extraction, **pas une probabilité d'être cité**. Les langues non prises en charge ne sont pas jugées ; la couverture du score baisse. Détail et origine de chaque critère : `references/citabilite.md`.

## Scénarios

Le jeu de requêtes se génère de façon **déterministe** (profil × intentions × gabarits par langue, graine donnée) puis se **fige** (empreinte, version). Les requêtes qui contiennent la marque sont marquées et seront exclues des chiffres principaux. Toute comparaison future exige le même jeu, ou ne porte que sur l'intersection, dite. Le profil (activité, offre, public, zone) est construit **uniquement** avec les réponses de l'utilisateur et la sortie de l'audit, puis confirmé par lui.

## Scores

Dix scores sur 100, indépendants ; six de potentiel en 0.1, quatre `null` (mesure requise). Formule, couverture, règles et poids : [SCORING.md](SCORING.md). Un critère non calculable est **absent**, jamais 0 ; sous 50 % de couverture, la valeur n'est pas affichée. Les poids sont une convention de version : deux exécutions de versions de poids différentes ne se comparent pas.

## Validation

- Tests unitaires et d'intégration, sans Internet.
- **Sites de référence fictifs** à défauts semés (SPA vide, robots IA bloqués, hreflang cassé, sans entité claire, défi WAF, injection de prompt, site propre) : chaque défaut est dans un fichier de vérité ; rappel et faux positifs sont mesurés et versionnés (`evals/resultats-sites-v0.1.json`). Le site propre ne doit produire aucun constat bloquant ni important.
- **Évaluation de déclenchement** des skills par `claude -p` : résultats et limites dans le [README](README.md#limites).
- Les poids n'ont **pas** été validés contre des citations observées : aucun résultat de cette nature n'est revendiqué.
