# Plugin `seo` v1 — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** livrer le plugin Claude Code `seo` v1, qui audite un projet web puis corrige SEO technique et contenu directement dans son code, lot par lot après validation.

**Architecture :** un plugin dans `plugins/seo/` exposé par un marketplace à la racine du dépôt. Des outils Node déterministes, sans dépendance (`outils/*.mjs` : extraction HTML, contrôles, collecte, détection de stack, profil), sont appelés par six skills (`seo` point d'entrée + 5 spécialisés). Le jugement (lien URL → source, rédaction, correction) revient au modèle, guidé par `references/`. La qualité est prouvée par des fixtures à défauts semés et des évaluations `claude -p`.

**Tech Stack :** Node ≥ 18 (ESM `.mjs`, `fetch` natif, aucun paquet npm), PHP ≥ 8 (`php -S`, pour les fixtures et les évals uniquement), Claude Code CLI (`claude -p`, `--plugin-dir`).

**Spec :** `docs/seo/1-conception.md` (validée). Le lire avant toute tâche.

## Global Constraints

- Périmètre v1 : stacks **HTML statique, PHP sans framework, Twig, SPA Vue** ; secteur **santé** ; une fixture **sans défaut**.
- Licence **MIT pour `plugins/seo/` seul** (`plugins/seo/LICENSE`, `"license": "MIT"` dans `plugin.json`) ; le reste du dépôt garde « tous droits réservés », et `LICENSE` racine + README le disent.
- Aucun nom de projet privé, chemin de machine, serveur, jeton ou nom de personne réelle, nulle part (code, fixtures, docs). Fixtures : cabinets **fictifs**.
- Skills, références et docs en **français** ; commentaires de code en **anglais** (convention de `validation-produit`).
- Outils : Node ≥ 18, **zéro dépendance npm**, sortie JSON sur stdout, erreurs sur stderr, code de sortie ≠ 0 en cas d'échec.
- Les skills appellent les outils par un chemin **relatif à leur dossier de base** : `node <base du skill>/../../outils/seo.mjs …`. Si Node manque, le skill continue en lecture de code et le dit.
- Fichiers écrits dans le projet cible : **uniquement** sous `.claude/seo/` (`profil.md`, `audit.json`, `contenus-a-saisir.md`) tant qu'aucun lot n'est validé.
- Jamais : commit, push, écriture en base, modification de la prod. Lecture de la prod : seulement avec `--autoriser-prod`, délai ≥ 1000 ms entre requêtes, `robots.txt` respecté.
- Les règles du projet cible (CLAUDE.md, conventions) priment sur le plugin.
- Idée empruntée = citée (ex. runner de déclenchement repris de `validation-produit`, lui-même inspiré de `anthropics/skills`, Apache-2.0).

## Review Focus

1. **Projet sans site web** (CLI, API, bibliothèque) : `seo` dit « non applicable » et n'écrit rien. → Tâche 5 (`detecter` renvoie `rendu: "aucun"`) et Tâche 8 (cas négatifs de déclenchement).
2. **URL de prod fournie sans accord** : la collecte refuse ; avec accord, délai respecté et `Disallow` du `robots.txt` évité. → Tâche 4.
3. **HTML cassé ou JSON-LD invalide** : aucun plantage, constat `T-JSONLD-INVALIDE`. → Tâches 2 et 3.
4. **Le projet a déjà un helper SEO** : la correction l'utilise au lieu d'en recréer un. → Tâche 7 (fixture PHP avec `seo_meta()` existant) et Tâche 12 (motif vérifié).
5. **Relance après corrections** : les contrôles corrigés ne réapparaissent pas, l'historique du profil n'est pas repris. → Tâche 12 (phase 3 de l'éval).
6. **Projet dans une autre langue que le français** : textes rédigés dans la langue du projet, règles France non appliquées, mention « vérifier le droit local ». → Tâche 7 (fixture Twig en anglais) et Tâche 12.

---

## Fichiers

```
.claude-plugin/marketplace.json            Créer — marketplace du dépôt, expose seo
LICENSE, README.md                         Modifier — précision licence, section Plugins
.gitignore                                 Modifier — evals/.noms-interdits.local
plugins/seo/
  .claude-plugin/plugin.json               Créer
  LICENSE                                  Créer — MIT
  README.md                                Créer — installation, usage, outils optionnels
  outils/
    frontmatter.mjs   parseFrontMatter(texte) (repris de validation-produit/outils/persona.mjs)
    extraire.mjs      extraire(html, url) -> Faits
    controler.mjs     controler(pages, site) -> Constat[] ; CATALOGUE
    collecter.mjs     collecterDossier(dir), collecterUrl(url, opts), lireRobots(txt)
    detecter.mjs      detecter(dir) -> Stack
    profil.mjs        lireProfil(fichier), validerProfil(meta)
    seo.mjs           CLI : detecter | auditer | profil-valider
  references/
    controles.md  redaction.md  profil.md  audit-schema.md
    stacks/{html-statique,php,twig,vue-spa}.md
    secteurs/sante.md
  skills/{seo,seo-profil,seo-technique,seo-donnees-structurees,seo-contenu,seo-verification}/SKILL.md
  agents/auditeur-seo.md
  evals/
    test-outils.mjs  declenchement.json  eval-declenchement.mjs  eval-fixtures.mjs  resultats-*.json
    fixtures/{html-statique,php,twig,vue-spa,propre}/ (+ verite.json chacune)
```

## Types partagés (définis Tâches 2–6, utilisés ensuite)

```js
// Faits (extraire.mjs)
{ url, lang, title, description, canonical, robots, hreflang: [{lang, href}], og: {title, description, image},
  hn: [{niveau, texte}], images: [{src, alt, width, height}], liens: [{href, texte}],
  jsonld: [{brut, objet|null, erreur|null}], mots: number, corpsVide: boolean }
// Constat (controler.mjs)
{ controle: 'T-TITLE-DOUBLON', severite: 'bloquant'|'important'|'mineur', lot: 'meta', pages: [url], preuve: string }
// Stack (detecter.mjs)
{ stack: 'html-statique'|'php'|'twig'|'vue-spa'|'inconnue', rendu: 'statique'|'serveur'|'client'|'aucun',
  fichiersCles: string[], langues: string[], indices: string[] }
```

`audit.json` (écrit par les skills, schéma dans `references/audit-schema.md`) : `{ date, stack, constats: [Constat & { fichier_source, correction_proposee }] }`.

---

### Task 1 : socle du plugin et du marketplace

**Files :** Créer `.claude-plugin/marketplace.json`, `plugins/seo/.claude-plugin/plugin.json`, `plugins/seo/LICENSE`, `plugins/seo/README.md` (squelette), `plugins/seo/outils/frontmatter.mjs`, `plugins/seo/evals/test-outils.mjs`. Modifier `.gitignore`.

**Interfaces :** Produit `parseFrontMatter(texte) -> { meta: object, corps: string }` (YAML simple : scalaires, listes `- x`, objets imbriqués sur 2 espaces) ; le harnais `ok(cond, msg)` de `test-outils.mjs`.

- [ ] **Step 1 : tests** dans `test-outils.mjs`, section « 1. Socle » :
  - `marketplace.json` parse ; `name === 'kvarot-skills'` ; `plugins` contient `{ name: 'seo', source: './plugins/seo' }`.
  - `plugin.json` parse ; `name === 'seo'`, `license === 'MIT'`, `version` semver.
  - `plugins/seo/LICENSE` contient `MIT License`.
  - `parseFrontMatter('---\na: 1\nl:\n  - x\n  - y\no:\n  k: v\n---\ncorps')` → `meta.l` = `['x','y']`, `meta.o.k === 'v'`, `corps === 'corps'`.
  - Garde-fou noms privés : si `evals/.noms-interdits.local` existe, aucun fichier suivi par git sous `plugins/seo/` ne contient l'un de ses mots (insensible à la casse) ; sinon la vérification est **ignorée explicitement** (`ok(true, 'noms interdits : fichier local absent, ignoré')`).
- [ ] **Step 2 :** `node plugins/seo/evals/test-outils.mjs` → KO (fichiers absents).
- [ ] **Step 3 :** créer les fichiers. `frontmatter.mjs` reprend le parseur de `validation-produit/outils/persona.mjs` (même auteur, citer l'origine en commentaire). `.gitignore` : `plugins/seo/evals/.noms-interdits.local`.
- [ ] **Step 4 :** tests → tous `ok`. Puis `claude plugin validate plugins/seo` → aucune erreur (si la sous-commande n'existe pas dans la version installée, le noter dans le compte rendu de tâche).
- [ ] **Step 5 :** commit `seo: socle du plugin et marketplace du dépôt`.

### Task 2 : extraction des faits SEO d'une page HTML

**Files :** Créer `plugins/seo/outils/extraire.mjs`. Test : `test-outils.mjs` section « 2. Extraction ».

**Interfaces :** Produit `extraire(html: string, url: string) -> Faits` (type ci-dessus). Ne lève jamais d'exception.

- [ ] **Step 1 : tests** sur des chaînes HTML en ligne :
  - title, description, canonical, robots, `lang`, hreflang, og:title extraits ; entités décodées (`&amp;` → `&`).
  - `hn` dans l'ordre du document avec leur niveau ; texte nettoyé des balises internes.
  - `<img src="a.jpg">` → `alt: null` ; `<img alt="">` → `alt: ''` (décoratif, distinct de absent).
  - deux `<script type="application/ld+json">`, l'un valide, l'autre `{"@type": "X",}` → `objet` rempli pour le premier, `erreur` non nulle pour le second.
  - `mots` ne compte que le texte visible (hors `script`, `style`, `noscript`).
  - `<body><div id="app"></div><script src="x.js"></script></body>` → `corpsVide === true`.
  - HTML tronqué (`<html><head><title>X`) → pas d'exception, `title === 'X'`.
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** implémenter `extraire` avec un petit tokeniseur de balises (pas de DOM) ; `corpsVide` = moins de 20 mots visibles dans `body`.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: extraction des faits SEO d'une page`.

### Task 3 : catalogue et moteur de contrôles

**Files :** Créer `plugins/seo/outils/controler.mjs`, `plugins/seo/references/controles.md`. Test : section « 3. Contrôles ».

**Interfaces :**
- Consomme : `Faits` (Tâche 2).
- Produit : `CATALOGUE: Array<{ id, severite, lot, description }>` et `controler(pages: Faits[], site: { robotsTxt: string|null, sitemapXml: string|null, urlsConnues: string[] }) -> Constat[]`, triés par `priorite` décroissante, avec `priorite = poids(severite) × pages.length` (bloquant 3, important 2, mineur 1).

Catalogue v1 (id → sévérité, lot) :

| id | sévérité | lot | règle |
|---|---|---|---|
| T-TITLE-ABSENT | bloquant | meta | pas de title ou vide |
| T-TITLE-DOUBLON | important | meta | même title sur ≥ 2 pages |
| T-TITLE-LONGUEUR | mineur | meta | hors 30–60 caractères |
| T-DESC-ABSENT | important | meta | pas de meta description |
| T-DESC-DOUBLON | important | meta | même description sur ≥ 2 pages |
| T-DESC-LONGUEUR | mineur | meta | hors 70–160 caractères |
| T-CANONICAL-ABSENT | mineur | meta | pas de canonical |
| T-CANONICAL-INVALIDE | important | meta | canonical relatif ou vers autre domaine |
| T-ROBOTS-NOINDEX | bloquant | indexation | `noindex` sur une page publique |
| T-ROBOTSTXT-ABSENT | mineur | indexation | `robotsTxt === null` |
| T-ROBOTSTXT-BLOQUE-TOUT | bloquant | indexation | `Disallow: /` pour `User-agent: *` |
| T-SITEMAP-ABSENT | important | indexation | `sitemapXml === null` |
| T-SITEMAP-INCOHERENT | mineur | indexation | page connue absente du sitemap, ou URL du sitemap inconnue |
| T-HREFLANG-INCOHERENT | important | international | hreflang sans réciproque ou sans `x-default` quand ≥ 2 langues |
| T-LANG-ABSENT | important | international | pas d'attribut `lang` |
| T-OG-ABSENT | mineur | partage | og:title ou og:description absent |
| T-H1-ABSENT | important | structure | aucun h1 |
| T-H1-MULTIPLE | mineur | structure | plus d'un h1 |
| T-HN-SAUT | mineur | structure | saut de niveau (h2 → h4) |
| T-ALT-ABSENT | important | images | `alt === null` |
| T-IMG-DIMENSIONS | mineur | performance | img sans width et height |
| T-LIEN-CASSE | important | liens | lien interne vers URL inconnue |
| T-PAGE-ORPHELINE | mineur | liens | page connue sans lien entrant |
| T-SPA-HTML-VIDE | bloquant | architecture | `corpsVide` |
| T-JSONLD-INVALIDE | important | donnees-structurees | JSON-LD non parsable ou sans `@type` |
| T-JSONLD-INTERDIT | bloquant | donnees-structurees | `AggregateRating` ou `Review` présent (à justifier par de vrais avis visibles) |
| C-PAGE-PAUVRE | mineur | contenu | moins de 300 mots visibles |
| C-ANCRE-GENERIQUE | mineur | contenu | ancre = « cliquez ici », « ici », « en savoir plus », « lire la suite », « click here », « here », « read more » (insensible à la casse, ponctuation ignorée) |

`controles.md` reprend ce tableau, ajoute pour chaque id la correction type et une source (Google Search Central, schema.org, etc.) ; le constructeur choisit et cite les sources.

- [ ] **Step 1 : tests** : un test par id, déclenché par un `Faits` minimal construit à la main, et un test « page conforme → aucun constat ». Plus : **chaque id de `CATALOGUE` apparaît dans `controles.md` et inversement** (lecture du tableau markdown).
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** implémenter `CATALOGUE` et `controler` ; écrire `controles.md`.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: catalogue et moteur de contrôles`.

### Task 4 : collecte (dossier local, URL) et CLI `auditer`

**Files :** Créer `plugins/seo/outils/collecter.mjs`, `plugins/seo/outils/seo.mjs`. Test : section « 4. Collecte ».

**Interfaces :**
- Consomme : `extraire`, `controler`.
- Produit :
  - `collecterDossier(dir) -> { pages: Faits[], site }` : tous les `*.html` (URL = chemin relatif, `index.html` → `/`), `robots.txt` et `sitemap.xml` à la racine.
  - `collecterUrl(url, { maxPages = 50, delaiMs = 1000, autoriserProd = false, hotesDev = ['localhost','127.0.0.1'] }) -> Promise<{ pages, site }>` : exploration en largeur des liens internes, même hôte.
  - `lireRobots(txt) -> { estAutorise(chemin): boolean }` (groupe `User-agent: *`, `Disallow`/`Allow`, préfixe le plus long gagne).
  - CLI `node seo.mjs auditer --dossier <d> | --url <u> [--max-pages n] [--delai-ms n] [--autoriser-prod]` → JSON `{ stack: null, constats }` sur stdout.

- [ ] **Step 1 : tests** avec un serveur `http` local lancé dans le test :
  - collecte en largeur, `maxPages` respecté, liens externes non suivis.
  - délai : 3 pages avec `delaiMs: 200` → durée totale ≥ 400 ms.
  - chemin `Disallow` dans `robots.txt` jamais demandé (compteur de requêtes côté serveur).
  - hôte hors `hotesDev` sans `autoriserProd` → rejet avec message contenant `--autoriser-prod`, **aucune requête** émise ; avec `autoriserProd` et `delaiMs < 1000` → délai forcé à 1000.
  - `collecterDossier` sur un dossier temporaire de 2 pages + robots → `site.robotsTxt` lu, URLs `/` et `/b.html`.
  - CLI `auditer --dossier` → JSON valide, code 0 ; dossier inexistant → code ≠ 0, message sur stderr.
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: collecte locale et distante, commande auditer`.

### Task 5 : détection de stack et références par stack

**Files :** Créer `plugins/seo/outils/detecter.mjs`, `plugins/seo/references/stacks/{html-statique,php,twig,vue-spa}.md`. Modifier `seo.mjs` (commande `detecter <dossier>`). Test : section « 5. Détection ».

**Interfaces :** Produit `detecter(dir) -> Stack`. Règles, première qui s'applique :
1. `package.json` avec dépendance `vue` et `index.html` contenant un conteneur vide (`id="app"`) → `vue-spa`, `client`.
2. fichiers `*.twig` → `twig`, `serveur`.
3. fichiers `*.php` produisant du HTML (`<html`, `<head` ou `include` d'un fichier qui en contient) → `php`, `serveur`.
4. fichiers `*.html` → `html-statique`, `statique`.
5. sinon → `inconnue`, `aucun`.
`langues` : valeurs `lang` trouvées dans les templates. `indices` : raisons en clair (ex. `"dépendance vue dans package.json"`). Ignorer `node_modules`, `vendor`, `.git`, `dist` (sauf pour la règle 1, qui lit `index.html` racine).

Chaque fichier `stacks/*.md` donne : où naît le HTML, où vivent title/meta, comment ajouter sitemap et robots, comment relier une URL à sa source, pièges connus. Pour `vue-spa` : `document.title`/`meta` par route (`router.meta` + garde `afterEach`), limites (robots qui n'exécutent pas le JS), pistes d'architecture (pré-rendu, SSR) **à proposer, pas à engager**.

- [ ] **Step 1 : tests** sur dossiers temporaires créés dans le test : un par règle ; un dossier ne contenant qu'un `main.go` → `rendu: 'aucun'` ; `node_modules/x/index.html` seul → `inconnue`.
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** implémenter ; écrire les 4 références.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: détection de stack et références par stack`.

### Task 6 : profil du projet

**Files :** Créer `plugins/seo/outils/profil.mjs`, `plugins/seo/references/profil.md`, `plugins/seo/references/audit-schema.md`. Modifier `seo.mjs` (commande `profil-valider <fichier>`). Test : section « 6. Profil ».

**Interfaces :** Produit `lireProfil(fichier) -> { meta, corps }` et `validerProfil(meta) -> string[]` (liste d'erreurs, vide si valide).

Front matter du profil (`.claude/seo/profil.md`) — champs obligatoires : `version: 1`, `stack`, `rendu`, `langues` (liste), `public`, `offre`, `ton`, `secteur` (`sante` | `aucun` | autre chaîne), `pays` (code ISO, ex. `FR`), `outils: { search_console: bool, navigateur: bool }`, `confirme_le` (date ISO, présence = discours confirmé par le développeur). Optionnels : `urls: { dev, prod }`, `mots_cles` (objet type de page → liste), `termes_a_eviter`, `pages` (liste `{ url, source }`), `historique` (liste `{ date, lot, controles }`). Le corps libre porte les notes.

`audit-schema.md` décrit `audit.json` (voir « Types partagés ») et `contenus-a-saisir.md` (tableau page | champ | texte actuel | texte proposé | raison).

- [ ] **Step 1 : tests** : profil complet → `[]` ; sans `confirme_le` → erreur contenant `confirme_le` ; `langues` non liste → erreur ; `outils.search_console` non booléen → erreur ; CLI `profil-valider` code 0 / ≠ 0.
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** implémenter ; écrire les deux références.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: format et validation du profil projet`.

### Task 7 : fixtures à défauts semés

**Files :** Créer `plugins/seo/evals/fixtures/{html-statique,php,twig,vue-spa,propre}/` et un `verite.json` par fixture. Test : section « 7. Fixtures ».

Toutes : cabinet **fictif** du secteur santé (kinésithérapie), 3 pages (accueil, soins, contact), aucun chiffre invérifiable dans les textes d'origine.

`verite.json` : `{ langue, rendu_local: 'dossier'|'php-s'|'aucun', defauts: [{ controle, fichier_source, verif_apres: { type: 'controle' } | { type: 'motif', fichier, present?: regex, absent?: regex } }] }`.

Défauts semés :
- **html-statique** (fr) : T-TITLE-DOUBLON (soins/contact), T-DESC-ABSENT (contact), T-H1-MULTIPLE (accueil), T-ALT-ABSENT (soins), T-SITEMAP-ABSENT, T-CANONICAL-ABSENT, T-JSONLD-INTERDIT (`AggregateRating` sur accueil), C-ANCRE-GENERIQUE (« cliquez ici »).
- **php** (fr) : `inc/header.php` inclus par les 3 pages avec un title codé en dur → T-TITLE-DOUBLON, `fichier_source: inc/header.php` ; T-LANG-ABSENT (header) ; T-ROBOTSTXT-BLOQUE-TOUT ; T-HN-SAUT (soins). Un helper **existant** `inc/seo.php` : `seo_meta(string $titre, string $description): string`, utilisé par aucune page → `verif_apres` motif : chaque page appelle `seo_meta(`, aucune balise `<title>` ajoutée dans les pages.
- **twig** (**en**, cabinet fictif au Royaume-Uni, `pays` GB) : `base.html.twig` avec `{% block title %}Physio{% endblock %}` non surchargé → T-TITLE-DOUBLON ; pas de bloc description → T-DESC-ABSENT ; T-OG-ABSENT. Code seul (`rendu_local: 'aucun'`), vérifs par motif.
- **vue-spa** (fr) : `index.html` avec `<div id="app"></div>` et `<title>Vite App</title>`, `src/router.js` sans `meta` → T-SPA-HTML-VIDE, T-TITLE-DOUBLON ; `dist/index.html` versionné (coquille vide) ; `package.json` avec `vue` et `vue-router`. `verif_apres` motif : `meta: { title` dans `src/router.js`, `document.title` dans `src/` ; **absent** de `package.json` : `vite-ssg|nuxt|@vue/server-renderer`.
- **propre** (fr) : 3 pages conformes, robots, sitemap, JSON-LD `MedicalBusiness` valide → aucun constat bloquant ni important.

- [ ] **Step 1 : tests** : pour chaque fixture `rendu_local: 'dossier'` → `collecterDossier` + `controler` trouve **chaque** défaut semé de type contrôle, et `propre` n'a aucun constat `bloquant`/`important`. Pour `php` : lancer `php -S 127.0.0.1:<port libre>` dans la fixture, `collecterUrl`, mêmes attentes ; si `php` est absent, **ignoré explicitement**. `detecter` sur chaque fixture renvoie la stack attendue.
- [ ] **Step 2 :** tests → KO.
- [ ] **Step 3 :** écrire les fixtures.
- [ ] **Step 4 :** tests → `ok`.
- [ ] **Step 5 :** commit `seo: fixtures à défauts semés (v1)`.

### Task 8 : skills `seo` (point d'entrée) et `seo-profil`, évaluation de déclenchement

**Files :** Créer `plugins/seo/skills/seo/SKILL.md`, `plugins/seo/skills/seo-profil/SKILL.md`, `plugins/seo/evals/declenchement.json`, `plugins/seo/evals/eval-declenchement.mjs`.

**Interfaces :**
- Consomme : CLI `seo.mjs detecter|auditer|profil-valider`, `references/*`.
- Produit : le déroulé de la spec §7.2 ; écriture de `.claude/seo/profil.md` et `.claude/seo/audit.json` ; la liste priorisée des lots présentée au développeur ; l'appel des skills spécialisés par nom.

`eval-declenchement.mjs` : repris de `validation-produit/evals/eval-declenchement.mjs` (citer), avec `--plugin-dir plugins/seo` et un paramètre `--skill`. Un cas déclenche si le premier appel d'outil est `Skill` avec le nom attendu (champ `skill_attendu` de chaque cas ; `null` pour un cas négatif).

`declenchement.json` : ≥ 24 cas, en français et en anglais, dont ≥ 8 négatifs (campagne Google Ads, netlinking, « mon API REST est lente », test unitaire PHP, refonte graphique…) et des cas ciblés pour chaque skill spécialisé (`seo-contenu` : « réécris les meta descriptions de mes pages » ; `seo-donnees-structurees` : « ajoute le schema.org de mon cabinet »…).

Contenu imposé de `seo/SKILL.md` : les anti-objectifs de la spec §4 en règles numérotées ; le déroulé §7.2 ; « non applicable » si `detecter` renvoie `rendu: aucun` ; proposition de Search Console seulement si un outil de connecteur est présent dans la session ; rappel « les règles du projet priment ». `seo-profil/SKILL.md` : déduction du discours (accueil, README, textes d'interface), confirmation explicite avant d'écrire `confirme_le`, validation par `profil-valider`.

- [ ] **Step 1 :** écrire `declenchement.json` et le runner ; lancer `node plugins/seo/evals/eval-declenchement.mjs --runs 1` → les cas positifs échouent (skills absents).
- [ ] **Step 2 :** écrire les deux `SKILL.md`.
- [ ] **Step 3 :** relancer pour les cas de `seo` et `seo-profil` → rappel ≥ 0,8 et précision ≥ 0,8 sur ces cas.
- [ ] **Step 4 :** commit `seo: skills seo et seo-profil, éval de déclenchement`.

### Task 9 : skills `seo-technique` et `seo-donnees-structurees`

**Files :** Créer `plugins/seo/skills/seo-technique/SKILL.md`, `plugins/seo/skills/seo-donnees-structurees/SKILL.md`.

Contenu imposé : lire profil et `audit.json` (créer via `seo-profil` / `seo` si absents) ; pour chaque lot : localiser la source avec `references/stacks/<stack>.md`, **réutiliser l'existant** (helper, bloc, composant) avant d'en créer, présenter diff + justification, attendre la validation, écrire, appeler `seo-verification`, ajouter le lot à `historique`. Défauts d'architecture (`T-SPA-HTML-VIDE`) : expliquer et proposer les pistes de `vue-spa.md`, corriger le reste, **ne pas** ajouter de dépendance de rendu. Données structurées : JSON-LD uniquement ; types adaptés au secteur (`references/secteurs/`) ; **jamais** `AggregateRating`/`Review` sans avis réels visibles sur la page ; propriétés tirées du projet uniquement (adresse, horaires, téléphone présents dans le code ou le profil).

- [ ] **Step 1 :** éval de déclenchement sur leurs cas → échec.
- [ ] **Step 2 :** écrire les deux skills.
- [ ] **Step 3 :** éval → rappel ≥ 0,8, précision ≥ 0,8 sur leurs cas, sans régression des cas de la Tâche 8.
- [ ] **Step 4 :** commit `seo: skills technique et données structurées`.

### Task 10 : skill `seo-contenu`, règles de rédaction, secteur santé

**Files :** Créer `plugins/seo/skills/seo-contenu/SKILL.md`, `plugins/seo/references/redaction.md`, `plugins/seo/references/secteurs/sante.md`.

Contenu imposé :
- `redaction.md` : longueurs (alignées sur le catalogue : title 30–60, description 70–160), intention de recherche, un mot-clé principal par page sans bourrage, ancres descriptives, alt informatif ou vide si décoratif, FAQ seulement à partir d'informations du projet ; **interdits** : chiffre, prix, durée, ancienneté, résultat, avis, label ou certification absents du projet → signalés au développeur, jamais écrits.
- `sante.md` : partie générique (pas de promesse de guérison ou de résultat, pas de comparaison dénigrante, pas de témoignage présenté comme preuve d'efficacité, prudence sur les termes médicaux) ; section `FR` (règles de communication des professions de santé, sources officielles **citées avec date**) ; pour tout autre `pays` : appliquer la partie générique et signaler « vérifier le droit local ». Types schema.org suggérés (`MedicalBusiness`, `Physician`, `MedicalClinic`…) avec leurs limites.
- `seo-contenu/SKILL.md` : textes dans la ou les `langues` du profil ; refus si `confirme_le` absent (renvoyer vers `seo-profil`) ; présentation avant/après par lot ; contenu venant d'une base ou d'un CMS → `contenus-a-saisir.md`, jamais écrit.

- [ ] **Step 1 :** éval de déclenchement sur ses cas → échec.
- [ ] **Step 2 :** écrire les trois fichiers.
- [ ] **Step 3 :** éval → rappel ≥ 0,8, précision ≥ 0,8, sans régression.
- [ ] **Step 4 :** commit `seo: skill contenu, règles de rédaction, secteur santé`.

### Task 11 : skill `seo-verification` et agent `auditeur-seo`

**Files :** Créer `plugins/seo/skills/seo-verification/SKILL.md`, `plugins/seo/agents/auditeur-seo.md`.

Contenu imposé :
- vérification par ordre de préférence (spec §7.6) : MCP Chrome DevTools si présent (HTML rendu, Lighthouse SEO, JSON-LD extrait) → `seo.mjs auditer --url <dev>` → lecture du code ; **toujours** annoncer le niveau atteint (`navigateur` | `http` | `code`) ; comparer les constats avant/après par id.
- `auditeur-seo` : reçoit une liste de templates ou d'URL, renvoie des constats au format `audit.json` (avec `fichier_source`) ; outils lecture seule (Read, Grep, Glob, Bash pour `seo.mjs`) ; n'écrit rien. `seo` le lance en parallèle au-delà de 10 templates (valeur initiale, ajustable).

- [ ] **Step 1 :** éval de déclenchement sur ses cas → échec.
- [ ] **Step 2 :** écrire les deux fichiers.
- [ ] **Step 3 :** éval complète (tous les cas) → rappel ≥ 0,8, précision ≥ 0,8. Enregistrer `evals/resultats-declenchement-v1.json`.
- [ ] **Step 4 :** commit `seo: vérification et agent auditeur`.

### Task 12 : évaluation de bout en bout sur fixtures

**Files :** Créer `plugins/seo/evals/eval-fixtures.mjs`, `plugins/seo/evals/resultats-fixtures-v1.json`.

**Interfaces :** Consomme les fixtures et `verite.json` (Tâche 7), `audit.json` (schéma Tâche 6), `controler`/`collecterDossier`/`collecterUrl`.

`node eval-fixtures.mjs [--fixture <nom>] [--modele sonnet]`, pour chaque fixture : copie dans un dossier temporaire, `git init` + commit initial, puis trois phases `claude -p --plugin-dir plugins/seo` (outils autorisés : Read, Grep, Glob, Edit, Write, Bash(node:*), Skill, Agent) :
1. **Audit** — « Audite le SEO de ce projet sans rien corriger. Le profil que tu proposes est confirmé tel quel. » Vérifier : `.claude/seo/audit.json` valide ; chaque défaut semé présent avec le bon `fichier_source` ; `git status` ne montre de changements **que** sous `.claude/seo/`.
2. **Correction partielle puis totale** — html-statique : « J'approuve uniquement le lot meta. » → seuls des fichiers concernés par des constats du lot `meta` changent. Toutes : « J'approuve tous les lots proposés. » → chaque `verif_apres` passe (`controle` : recollecte + `controler`, le contrôle n'apparaît plus ; `motif` : regex). Contenu : aucun nombre de ≥ 2 chiffres présent dans les fichiers modifiés et absent de la fixture d'origine ; pas de `AggregateRating`/`Review` ; twig : nouvelles descriptions sans mots-outils français (`\b(le|la|les|des|et|du|pour)\b`) et réponse finale mentionnant le droit local.
3. **Relance** — « Refais l'audit. » → aucun contrôle corrigé ne réapparaît ; `historique` du profil contient les lots appliqués.

Seuils de réussite v1 : ≥ 90 % des défauts semés détectés avec la bonne source ; 0 écriture hors `.claude/seo/` en phase 1 ; 0 chiffre inventé ; `propre` : 0 constat bloquant ou important ; vue-spa : aucune dépendance de rendu ajoutée ; php : motif `seo_meta(` dans les 3 pages.

- [ ] **Step 1 :** écrire le runner ; le lancer sur `propre` seul → résultat produit (le runner fonctionne).
- [ ] **Step 2 :** lancer sur toutes les fixtures ; consigner `resultats-fixtures-v1.json`.
- [ ] **Step 3 :** pour chaque seuil manqué : corriger le skill ou la référence en cause, relancer la fixture concernée (au plus 3 itérations par défaut avant de le signaler comme limite connue dans le README).
- [ ] **Step 4 :** commit `seo: évaluation de bout en bout sur fixtures`.

### Task 13 : documentation et installation réelle

**Files :** Modifier `plugins/seo/README.md`, `README.md` (racine), `LICENSE` (racine).

Contenu : README du plugin (à quoi il sert, installation `/plugin marketplace add kvarot/skills` puis `/plugin install seo@kvarot-skills`, prérequis Node ≥ 18, outils optionnels MCP Chrome DevTools et connecteur Search Console, ce qu'il ne fait jamais, limites connues issues de la Tâche 12, licence MIT). README racine : section « Plugins » avec `seo` ; mention que `plugins/seo/` est sous MIT. `LICENSE` racine : phrase d'exception pour `plugins/seo/`.

- [ ] **Step 1 :** écrire la doc.
- [ ] **Step 2 :** dans un projet temporaire : `claude plugin marketplace add <chemin local du dépôt>` puis `claude plugin install seo@kvarot-skills` → les 6 skills et l'agent apparaissent (`/plugin` ou `claude -p "liste tes skills seo"`).
- [ ] **Step 3 :** `node plugins/seo/evals/test-outils.mjs` → tout `ok` (dont le garde-fou noms privés, fichier local présent sur la machine du propriétaire).
- [ ] **Step 4 :** commit `seo: documentation, licence MIT du plugin` puis `git push`.
