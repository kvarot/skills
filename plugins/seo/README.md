# seo

Plugin Claude Code qui audite le SEO d'un site web et corrige les défauts **dans le code du projet**, à l'endroit d'où ils viennent (layout, template, route), dans les conventions du projet. Chaque lot de corrections est présenté (diff, avant / après des textes) et n'est écrit qu'après votre validation, puis vérifié. Des outils déterministes en Node (sans dépendance) mesurent ce qui peut l'être ; le modèle relie chaque constat à son fichier source, classe les lots et rédige les corrections.

## Installation

```
/plugin marketplace add kvarot/skills
/plugin install seo@kvarot-skills
```

Prérequis : Node 18.3 ou plus pour les outils (`outils/*.mjs`, zéro dépendance npm). Sans Node, les skills continuent en lecture du code et le disent.

Optionnel, jamais requis :

- les outils MCP Chrome DevTools, pour vérifier les corrections sur le rendu réel (HTML rendu, Lighthouse, JSON-LD) ;
- un connecteur Search Console / Bing Webmaster : proposé seulement s'il est présent dans la session, rien n'est interrogé sans votre accord.

## Ce que contient le plugin

Six skills et un agent, en français :

| Skill | Rôle |
|---|---|
| `seo` | Point d'entrée : détecte la stack, construit le profil, audite, classe les lots de corrections et les confie aux skills spécialisés. |
| `seo-profil` | Crée ou met à jour `.claude/seo/profil.md` (public, offre, ton, langues, secteur, pays, mots-clés). |
| `seo-technique` | Sitemap, robots.txt, canonical, hreflang, attribut `lang`, niveaux de titres, helper de balises meta. |
| `seo-contenu` | Titres, meta descriptions, textes de titres, attributs `alt`, ancres de liens, FAQ. |
| `seo-donnees-structurees` | JSON-LD schema.org (LocalBusiness, MedicalBusiness, FAQPage...). |
| `seo-verification` | Contrôle des corrections sur la page rendue et comparaison avec l'audit précédent. |

L'agent `auditeur-seo` (lecture seule) audite un lot de templates en parallèle sur les grands sites (plus de 10 templates ou types de page).

Périmètre v1 : HTML statique, PHP sans framework, Twig, SPA Vue. Secteur santé pris en charge ; pour la santé en France, le skill `seo` rappelle les règles de publicité des professionnels de santé (R.4321-123 II du code de la santé publique, recommandations de l'ordre) avant d'écrire des textes.

## Ce qu'il ne fait jamais

- Aucun commit, aucun push, aucune écriture en base, aucune modification de la production.
- Seuls fichiers écrits hors du code corrigé : `.claude/seo/` (`profil.md`, `audit.json`, `contenus-a-saisir.md`). Un contenu qui vit en base ou dans un CMS est listé dans `contenus-a-saisir.md`, pas écrit.
- Lecture de la production seulement avec votre accord explicite (`--autoriser-prod`), avec un délai d'au moins 1 s entre requêtes et `robots.txt` respecté.
- Pas de faux avis ni de note inventée, pas de chiffre ou de numéro de téléphone inventé : les valeurs sont recopiées du projet.
- Les règles du projet cible (CLAUDE.md, conventions) priment sur celles du plugin.

## Évaluation

- `node plugins/seo/evals/test-outils.mjs` : tests des outils, sans modèle.
- `node plugins/seo/evals/eval-fixtures.mjs [--fixture <nom>[,<nom>]] [--modele sonnet] [--parallele 1]` : évaluation de bout en bout sur les fixtures de `evals/fixtures/` (environ 2 USD et 8 minutes pour les cinq). Chaque fixture est copiée dans un dossier temporaire versionné par git, puis trois phases `claude -p --plugin-dir` s'enchaînent dans une même conversation (`--resume`) : audit sans correction, approbation des lots (html-statique : lot `meta` seul, puis tous), nouvel audit. Outils permis : Read, Grep, Glob, Edit, Write, `Bash(node:*)`, Skill, Agent ; `evals/permission-seo.mjs` approuve seulement les écritures sous `.claude/seo/`. Pour `php`, le harnais lance lui-même `php -S` et donne l'URL dans le message. Résultats et seuils : `evals/resultats-fixtures-v1.json`.

Limites connues de l'évaluation :

- Une entrée de `verite.json` = un défaut attendu : `php` a quatre entrées `T-TITLE-DOUBLON` sur `inc/header.php` (appel du helper `seo_meta()` n'importe où dans l'arbre, hors définition, puis aucun `<title>` écrit dans chaque page) ; le taux de détection compte chacune. Tout défaut `detection: controle` dont la source est rendue par le harnais est en plus recollecté après correction, quel que soit son `verif_apres` : le contrôle doit avoir été relevé avant et avoir disparu après.
- `vue-spa` : `dist/` est un build versionné que l'évaluation ne reconstruit pas ; les défauts `detection: controle` des sources ne sont donc ni recollectés ni relus en phase 3 (« non applicable ») ; ceux du routeur (`detection: modele`) le sont. `T-SPA-HTML-VIDE` côté `index.html` est jugé sur l'explication donnée dans la réponse de phase 2.
- `historique` attendu : les lots des défauts corrigés en phase 2 dont le fichier source a été modifié (un défaut `explication` n'en ajoute pas).
- Code de sortie 1 dès qu'un seuil, un contrôle de phase ou la vérification d'un défaut échoue. Avec `--fixture`, les autres fixtures gardent leur résultat précédent ; `summary.fixtures_autre_harnais` liste celles évaluées par une autre version du harnais.
- `twig` : aucun rendu local, corrections vérifiées par motif dans les templates seulement.
- La « réponse mentionne le droit local » (`twig`) et l'absence de chiffre inventé reposent sur des regex : un chiffre recopié du projet sous une autre forme (`+33 1 99…` pour `01 99…`) compte comme inventé.
- Un seul passage par fixture : le modèle n'est pas déterministe, un seuil réussi une fois n'est pas garanti à chaque passage. Deux points ont déjà échoué lors de passages précédents et peuvent encore être instables : la détection du domaine déclaré par le projet (`canonical` et `sitemap` de `html-statique`) et l'appel du helper `seo_meta()` de `php`.

## Licence

MIT, voir [`LICENSE`](LICENSE). Ce plugin est la seule partie du dépôt sous MIT.
