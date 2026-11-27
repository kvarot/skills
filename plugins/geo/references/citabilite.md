# Citabilité du contenu : critères et origine

Ce document décrit l’analyse de `outils/lib/contenu.mjs`. Les sections citées (§2.4, §2.5) renvoient au dossier de référence `docs/geo/0-benchmark.md`.

**Ces critères décrivent la facilité d’extraction, pas une probabilité d’être cité.**

## Principe

Un passage est un titre et les blocs qui le suivent jusqu’au titre suivant ; les blocs placés avant le premier titre forment un passage sans titre. Chaque passage reçoit six critères booléens ; sa note est le nombre de critères vrais (0 à 6), sans pondération. Il n’y a aucun critère de longueur : Google indique ne pas avoir de longueur idéale ni de découpage en petits morceaux (§2.5, OFFICIEL).

Sont exclus des passages : les blocs `nosnippet` ou `data-nosnippet` (ils ne peuvent pas être cités) et les passages sans corps (titres consécutifs).

Langues : français et anglais seulement. La langue vient de l’attribut `lang` de la page quand il vaut `fr*` ou `en*` ; toute autre valeur déclarée donne « autre ». Sans `lang`, une langue (fr ou en) n’est retenue que si sa part de mots vides distinctifs atteint 5 % et vaut au moins 1,5 fois celle de la meilleure autre langue ; les listes `donnees/langues/_autres.json` (espagnol, italien, portugais, néerlandais, allemand) servent à refuser ces pages. En langue « autre », rien n’est calculé : aucun passage, aucun constat de contenu, et les rapports indiquent « non calculé : langue non prise en charge ».

## Les six critères

| Critère | Définition mesurée | Origine | Classe de source |
|---|---|---|---|
| `definition` | Motif « X est un / une / des » ou « X is a / an / the », « X are » dans les deux premières phrases, sujet non pronominal ; ou bloc de définition. | Choix du concepteur, aucune source du dossier de référence. | aucune |
| `chiffre` | Un nombre suivi d’une unité, de `%` ou d’une monnaie (€, $, £), virgule décimale et espaces fines admises. | Levier « statistiques » de Aggarwal et al. (KDD 2024) : à tester, pas prouvé ; l’effet n’est pas retrouvé par C-SEO Bench (§2.4). | ÉVALUÉ PAR LES PAIRS (hypothèse à tester) |
| `source` | Formule de source (« selon », « d’après », « source : », « according to »…) ou lien externe dans le passage. | Levier « citations » de Aggarwal et al. (KDD 2024) : à tester, pas prouvé ; non retrouvé par C-SEO Bench (§2.4). | ÉVALUÉ PAR LES PAIRS (hypothèse à tester) |
| `autonome` | La première phrase ne commence pas par un pronom ou un connecteur de la liste de la langue. | Choix du concepteur : un passage extrait seul doit se comprendre. | aucune |
| `question_titre` | Le titre est une question (point d’interrogation ou mot interrogatif initial). | Choix du concepteur, voisin des titres clairs et des FAQ que Bing dit utiles (§2.5). | OFFICIEL (Bing, pour les titres clairs et les FAQ seulement) |
| `structure` | Le passage contient une liste ou un tableau. | Bing : titres clairs, tableaux et FAQ aident à faire ressortir l’information ; Microsoft Advertising : éviter les murs de texte (§2.5). | OFFICIEL (Bing) ; MARKETING (Microsoft Advertising, sans effet chiffré) |

Les leviers de recherche (§2.4) sont des hypothèses à tester : les gains publiés ont été mesurés sur un moteur simulé et ne se retrouvent pas dans C-SEO Bench ; le rang de récupération pèse bien plus. Google précise qu’optimiser pour la recherche générative reste du SEO (§2.5).

## Limites connues

- Le lien externe d’un passage est déduit : les faits extraits ne rattachent pas les liens aux blocs. Un lien compte quand son texte (3 caractères au moins) figure tel quel dans un bloc du passage et que son hôte diffère de celui de la page.
- « selon » et « according to » au sens de « en fonction de » (« selon la taille ») sont comptés comme une source : limite connue.
- Les motifs sont des heuristiques par expressions régulières : faux positifs et faux négatifs possibles, listes de mots dans `donnees/langues/`.
- Les quatre constats de contenu (`GEO-CONTENU-*`) sont de classe heuristique et de gravité mineure ; ils sont documentés dans `constats.md`.
