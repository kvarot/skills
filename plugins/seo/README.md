# seo

Plugin Claude Code d'audit SEO et GEO d'un site web. Il s'appuie sur des outils déterministes en Node (sans dépendance) pour mesurer ce qui peut l'être, puis sur le modèle pour interpréter les résultats et produire un plan d'actions priorisé.

Ce README est un squelette : l'installation, les commandes et les limites seront documentées au fil du développement du plugin.

## Évaluation

- `node evals/test-outils.mjs` : tests des outils, sans modèle.
- `node evals/eval-fixtures.mjs [--fixture <nom>[,<nom>]] [--modele sonnet] [--parallele 1]` : évaluation de bout en bout sur les fixtures de `evals/fixtures/` (environ 2 USD et 8 minutes pour les cinq). Chaque fixture est copiée dans un dossier temporaire versionné par git, puis trois phases `claude -p --plugin-dir` s'enchaînent dans une même conversation (`--resume`) : audit sans correction, approbation des lots (html-statique : lot `meta` seul, puis tous), nouvel audit. Outils permis : Read, Grep, Glob, Edit, Write, `Bash(node:*)`, Skill, Agent ; `evals/permission-seo.mjs` approuve seulement les écritures sous `.claude/seo/`. Pour `php`, le harnais lance lui-même `php -S` et donne l'URL dans le message. Résultats et seuils : `evals/resultats-fixtures-v1.json`.

Limites connues de l'évaluation :

- Une entrée de `verite.json` = un défaut attendu : `php` a quatre entrées `T-TITLE-DOUBLON` sur `inc/header.php` (appel du helper `seo_meta()` n'importe où dans l'arbre, hors définition, puis aucun `<title>` écrit dans chaque page) ; le taux de détection compte chacune.
- `vue-spa` : `dist/` est un build versionné que l'évaluation ne reconstruit pas ; la relance (phase 3) ne peut donc pas confirmer les corrections des sources, notées « non applicable ». `T-SPA-HTML-VIDE` côté `index.html` est jugé sur l'explication donnée dans la réponse.
- `twig` : aucun rendu local, corrections vérifiées par motif dans les templates seulement.
- La « réponse mentionne le droit local » (`twig`) et l'absence de chiffre inventé reposent sur des regex : un chiffre recopié du projet sous une autre forme (`+33 1 99…` pour `01 99…`) compte comme inventé.
- Un seul passage par fixture : le modèle n'est pas déterministe, un seuil réussi une fois n'est pas garanti à chaque passage.

Licence MIT (voir `LICENSE`).
