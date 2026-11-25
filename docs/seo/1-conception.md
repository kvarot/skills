# Plugin `seo` — conception

## 1. Intention

Les outils SEO pour agents (audits, crawlers, plugins existants) produisent un **rapport**. Le développeur doit ensuite retrouver lui-même, dans son code, le template, le layout, le contrôleur ou la configuration qui produit chaque défaut, puis écrire la correction.

Ce plugin fait l'inverse : il **corrige directement dans le code du projet**, à l'endroit d'où vient le défaut, avec les conventions du projet. Il traite la technique **et** le contenu (titres, descriptions, textes). Il s'adapte à ce qu'il trouve : stack, type de site, secteur, outils disponibles dans la session.

Public : n'importe quel développeur qui installe le plugin, sur n'importe quel projet web. Rien dans le plugin ne cite un projet particulier.

## 2. Objectifs

1. Détecter seul la stack, la façon dont le HTML est produit et les pages publiques du projet.
2. Relier chaque URL publique (ou chaque type de page) au fichier source qui la génère.
3. Trouver les défauts SEO techniques et de contenu, les prioriser par impact et effort.
4. Proposer les corrections **par lot**, avec diff et justification, et n'écrire qu'après validation du développeur.
5. Écrire les corrections dans le style du projet : helpers existants, système de traduction, composants partagés, factorisation plutôt que copier-coller.
6. Rédiger les contenus (title, meta description, hiérarchie Hn, alt, ancres, FAQ, enrichissement de pages pauvres) selon le public, le ton et l'offre du projet.
7. Vérifier chaque correction sur le rendu réel quand c'est possible, et dire clairement quand la vérification n'a porté que sur le code.
8. Utiliser Google Search Console / Bing Webmaster Tools si le développeur l'accepte et qu'un connecteur est disponible ; fonctionner pleinement sans.

## 3. Non-objectifs

- Netlinking, achat de liens, suivi de positions, publicité payante.
- Analyse SEO des sites concurrents au-delà d'une recherche web ponctuelle sur les mots-clés.
- Dépendance à un outil payant (Semrush, Ahrefs, Moz…).
- Fournir lui-même un connecteur Search Console (il utilise celui de la session s'il existe).

## 4. Anti-objectifs (échec même si « ça marche »)

- Écrire dans le code ou les textes sans validation explicite du lot.
- Inventer un chiffre, une promesse, un avis client, une note, une certification, un prix. Une affirmation non tirée du projet est signalée, jamais écrite.
- Pratiques pénalisables : bourrage de mots-clés, texte caché, données structurées trompeuses (faux avis, `AggregateRating` sans avis réels), cloaking, pages satellites.
- Refondre l'architecture (passer une SPA en SSR, changer de framework) de sa propre initiative.
- Écrire en base de données, dans un CMS distant, ou modifier un environnement de production. La **lecture** de la prod (GET des pages publiques, `robots.txt`, `sitemap.xml`, Lighthouse) est permise seulement après accord du développeur, à débit limité.
- Commiter ou pousser.
- Ignorer les règles du projet (CLAUDE.md, conventions) : elles priment sur le plugin.
- Mentionner un projet privé dans le plugin, ses exemples, ses fixtures ou sa doc.

## 5. Contraintes

- Format plugin Claude Code : `.claude-plugin/plugin.json`, `skills/`, `agents/`, références en fichiers séparés chargés à la demande.
- Distribution par le marketplace du dépôt (`.claude-plugin/marketplace.json` à la racine) : `/plugin marketplace add <dépôt>` puis `/plugin install seo@<marketplace>`.
- Règles du dépôt : rien de personnel ni de sensible, idées empruntées citées.
- Licence : **MIT pour le plugin seul** (`plugins/seo/LICENSE`, champ `license` de `plugin.json`) ; le reste du dépôt garde sa licence actuelle, et `LICENSE` / README le précisent.
- Instructions des skills en français (langue du dépôt). Les **contenus produits** suivent la langue du projet cible, éventuellement plusieurs (hreflang).
- Outils optionnels détectés à l'exécution, jamais supposés : MCP Chrome DevTools, connecteur Search Console, URL de dev accessible.
- Skills courts : chaque `SKILL.md` reste lisible ; le détail va dans `references/`.

## 6. Approches considérées

| Approche | Avantages | Inconvénients | Décision |
|---|---|---|---|
| **A. Point d'entrée + skills spécialisés + références par stack et secteur** | skills courts et bien ciblés, déclenchement précis (« corrige mes meta » → `seo-contenu`), références chargées à la demande, ajout d'une stack = un fichier | plus de fichiers, point d'entrée à soigner | **retenue** |
| B. Un seul gros skill + références | simple à écrire et installer | instructions très longues, mauvais déclenchement sur demande ciblée, contexte chargé inutilement | écartée |
| C. Couche au-dessus d'un plugin SEO tiers (audit délégué) | moins de travail d'audit | dépendance à un projet tiers (format, maintenance), deux installations | écartée |

## 7. Architecture

```
plugins/seo/
├── .claude-plugin/plugin.json
├── README.md
├── skills/
│   ├── seo/                       point d'entrée : détection, profil, audit, priorisation, orientation
│   ├── seo-profil/                construit / met à jour le profil du projet
│   ├── seo-technique/             corrections techniques
│   ├── seo-donnees-structurees/   schema.org (JSON-LD)
│   ├── seo-contenu/               rédaction et réécriture
│   └── seo-verification/          contrôle sur le rendu réel
├── references/
│   ├── stacks/      un fichier par stack : où naît le HTML, où vivent les meta, comment ajouter sitemap/robots, pièges
│   ├── secteurs/    règles de communication et données structurées propres au secteur
│   ├── controles.md catalogue des contrôles (id stable, sévérité, détection, correction type)
│   └── redaction.md règles de rédaction (longueurs, intention de recherche, garde-fous)
├── agents/
│   └── auditeur-seo.md   audit d'un lot de pages / templates, lancé en parallèle sur gros sites
└── evals/
    └── fixtures/   petits projets d'exemple par stack avec défauts semés
```

### 7.1 Profil du projet

Fichier écrit dans le projet cible : `.claude/seo/profil.md`. Le développeur choisit de le commiter ou non.

Contenu :
- **Technique** : stack détectée, mode de rendu (serveur, client, hybride, statique, CMS), fichiers clés (layouts, helper de meta, routeur, i18n), pages ou types de pages publics avec leur source, URL de prod et de dev si fournies.
- **Discours** : public visé, offre, ton, langues, mots-clés principaux par type de page, termes à éviter.
- **Secteur** et références de secteur actives.
- **Outils** : Search Console oui/non, vérification navigateur oui/non.
- **Historique** : lots appliqués (date, contrôles traités), pour ne pas reproposer ce qui est fait.

Le discours est **déduit** (page d'accueil, README, textes de l'interface, contenus existants) puis **confirmé** par le développeur avant toute rédaction.

### 7.2 Déroulé du point d'entrée `seo`

1. Lire le profil s'il existe ; sinon (ou s'il est périmé) appeler `seo-profil`.
2. Détecter les outils disponibles. Proposer la Search Console si un connecteur existe ; ne rien faire sans accord.
3. Auditer : code toujours ; rendu réel si une URL est disponible. Sur un site à nombreux templates, répartir sur des agents `auditeur-seo`.
4. Présenter une **liste priorisée de lots** (impact × effort), chaque lot = un type de correction (meta, canonical, sitemap, données structurées, Hn, alt, maillage, performances, contenu d'une page…).
5. Le développeur choisit les lots. Pour chacun : diff + justification + avant/après pour les textes → validation → écriture → vérification (`seo-verification`).
6. Mettre à jour l'historique du profil. Résumer ce qui est fait, vérifié, restant.

Les skills spécialisés sont aussi appelables directement (« ajoute les données structurées », « réécris mes descriptions »). Ils lisent le profil et le créent via `seo-profil` s'il manque.

### 7.3 Contrôles techniques (catalogue initial)

title et meta description (présence, unicité, longueur) ; canonical ; robots meta et `robots.txt` ; `sitemap.xml` (existence, génération, cohérence avec les pages publiques) ; hreflang ; Open Graph / Twitter Card ; hiérarchie Hn ; `alt` ; liens cassés internes ; redirections et codes HTTP (si URL) ; HTML vide côté serveur pour les SPA ; balise `lang` ; données structurées valides ; performances liées au SEO (images non dimensionnées, LCP, poids) ; pages orphelines.

Chaque contrôle a un id stable dans `references/controles.md`.

### 7.4 Contenu

Rédige : title, meta description, Hn, alt, ancres de liens internes, FAQ (avec `FAQPage` si pertinent), enrichissement de pages pauvres.

Règles : intention de recherche, longueurs, un mot-clé principal par page sans bourrage, ton du profil, aucune affirmation inventée, règles du secteur actif.

**Contenu en base ou dans un CMS** : jamais écrit. Le plugin produit `.claude/seo/contenus-a-saisir.md` (page, champ, texte actuel, texte proposé, raison) à appliquer dans l'administration.

### 7.5 Cas d'architecture

Si le défaut vient de l'architecture (ex. SPA sans rendu serveur, HTML vide pour les robots), le plugin l'explique, chiffre l'impact et propose des pistes (pré-rendu, SSR partiel, pages statiques pour le public) sans les engager. Il corrige quand même ce qui peut l'être dans l'existant.

### 7.6 Vérification

Par ordre de préférence : MCP Chrome DevTools (HTML rendu, Lighthouse SEO, données structurées extraites) ; requête HTTP sur l'URL de dev (HTML serveur) ; analyse du code seule, **annoncée comme telle**.

### 7.7 Stacks et secteurs couverts

**Version 1 (décidé)** : stacks HTML statique, PHP sans framework, Twig, SPA Vue ; secteur santé ; une fixture « sans défaut ». Les autres stacks et secteurs s'ajoutent ensuite un par un (un fichier de référence + une fixture chacun).

Cible à terme — stacks : HTML statique, PHP sans framework, Twig/Symfony, Laravel/Blade, WordPress (thème et extensions SEO existantes), SPA Vue et React (Vite), Next.js, Nuxt.

Secteurs : santé, juridique, finance, e-commerce. Le fichier secteur contient les règles de communication à respecter et les types schema.org adaptés ; il ne cite aucun produit.

*Choix du concepteur* — droit applicable : chaque fichier secteur a une partie générique (valable partout) et des sections par pays. La France est rédigée en premier ; pour un autre pays, le plugin applique la partie générique et signale qu'il faut vérifier le droit local, sans rien affirmer.

### 7.8 Place dans le dépôt

*Choix du concepteur* : le marketplace racine n'expose que `seo` pour l'instant ; les skills existants restent installables par copie, sans déplacement. Le README gagne une section « Plugins » (installation par marketplace) à côté du tableau des skills.

## 8. Évaluation

Sur le modèle de `validation-produit` (défauts semés) :
- une fixture par stack, avec des défauts semés listés dans un fichier de vérité ;
- critères : défauts détectés, source correctement localisée, correction conforme aux conventions de la fixture, rien écrit sans validation, aucun contenu inventé ;
- une fixture « sans défaut » pour mesurer les faux positifs.

*Choix du concepteur* : évaluations automatisées comme dans `validation-produit` (scripts `.mjs`, `claude -p`, résultats versionnés). Fixtures lues comme code, sauf HTML statique et PHP sans framework servis par `php -S` / serveur statique, pour tester la vérification sur rendu réel. Une SPA servie en statique couvre le cas « HTML vide côté serveur ». Pas de Docker.

## 9. Laissé au constructeur

- Seuil de répartition sur agents `auditeur-seo`.
- Formules exactes de priorisation impact × effort.
- Formulation des descriptions de skills (déclenchement).
- Liste fine des contrôles et des longueurs recommandées, avec sources.
- Contenu détaillé de chaque fichier de stack et de secteur.
- Forme exacte du diff présenté par lot.
