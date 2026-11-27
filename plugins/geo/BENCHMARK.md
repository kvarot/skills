# Benchmark (résumé)

Relevé du 2026-11-27. Le détail, les sources et les classes de preuve sont dans [`docs/geo/0-benchmark.md`](../../docs/geo/0-benchmark.md). Code lu par l'API de GitHub : aucun dépôt cloné ni exécuté, donc le fonctionnement réel des outils comparés n'est **pas vérifié**.

## Ce qui existe

- **Sept dépôts de la liste initiale**, dont quatre sous licence MIT avec du code utile : un scoreur de citabilité à expressions régulières dont cinq notes sur six sont données par le modèle ; un audit Python au score déterministe et aux tests solides ; un vérificateur d'accès des robots ; une suite de six outils Node. Deux dépôts sans licence (idées seulement) et un catalogue de conseils sans code.
- **Outils de suivi de visibilité auto-hébergeables** (hors liste) : les plus rigoureux gardent les réponses brutes, séparent mentions avec et sans marque, plafonnent les coûts et répètent les exécutions.
- **Faits officiels** : registre des robots des éditeurs, `llms.txt` (aucun éditeur ne déclare l'utiliser ; Google écrit que le maintenir n'aide ni ne nuit), consignes de Google et de Bing (« optimiser pour la recherche générative, c'est encore du SEO »).
- **Recherche** : résultats partiellement contradictoires et surtout obtenus sur des moteurs simulés ; la présence est assez stable d'une exécution à l'autre, le rang ne l'est pas.

## Ce qu'aucun ne fait (et que ce plugin vise)

Mesure par les API officielles ; échantillonnage répété avec intervalle de confiance ; réponses brutes conservées comme preuve ; scores validés contre des citations observées ; concurrents audités avec le même moteur ; heuristiques hors anglais ; **isolation du contenu collecté** de l'agent qui peut écrire.

En 0.1, le plugin couvre le moteur d'audit déterministe, les heuristiques FR / EN et l'isolation du contenu ; la mesure, les concurrents et la boucle de correction sont dans la [feuille de route](ROADMAP.md). Les scores de ce plugin sont des **conventions**, pas des prédictions validées ([SCORING.md](SCORING.md)).

Les licences et ce qui a été retenu de chaque projet : [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
