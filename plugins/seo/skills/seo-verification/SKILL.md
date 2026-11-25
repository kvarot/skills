---
name: seo-verification
description: Use when SEO fixes already written in a web project must be checked on the real page rather than in the diff - rendered HTML in the browser, Lighthouse SEO category, JSON-LD extracted from the page, or the HTML served on the dev URL - and compared with the previous audit to tell which issues are fixed, which remain and which are new regressions. Also runs the verification step after each written fix batch of the seo, seo-technique, seo-donnees-structurees and seo-contenu skills. Triggers - "vérifie sur le rendu réel que les corrections SEO sont en place", "repasse les pages sur l'URL de dev, qu'est-ce qui est corrigé ?", "contrôle que le JSON-LD apparaît bien dans la page", "check with Lighthouse that the SEO fixes show up in the rendered HTML", "re-check the pages after the SEO changes and list regressions". Not for a first whole-site audit or choosing what to fix (seo), writing fixes (seo-technique, seo-contenu, seo-donnees-structurees), Lighthouse performance score, rank tracking or end-to-end tests.
---

# SEO : vérification sur le rendu

Contrôle qu'un lot de corrections **écrit** produit bien l'effet attendu sur la page réelle, et compare les constats avant / après. Ce skill **n'écrit rien** dans le projet, `.claude/seo/` compris : `audit.json` n'a pas de champ d'état (`references/audit-schema.md`), il reste tel que l'audit l'a écrit, et l'`historique` du profil est mis à jour par le skill qui a porté le lot.

Outils : `node <base du skill>/../../outils/seo.mjs <commande>` (`<base du skill>` = dossier de base affiché au chargement de ce skill). Si Node manque, vérifier en lisant le code et **le dire** dans le résumé.

## Règles qui ne plient pas

1. **Les règles du projet priment** (CLAUDE.md, conventions) : les lire avant tout.
2. **Lecture seule.** Aucun fichier du projet modifié, créé ou supprimé. Un défaut trouvé est rapporté, jamais corrigé ici : la correction repasse par le skill du lot, avec validation.
3. **Ni build, ni installation, ni serveur lancé sans accord.** Un serveur lancé avec accord est arrêté à la fin (étape 3).
4. **Toujours annoncer le niveau atteint** : `navigateur`, `http` ou `code`, page par page s'il varie. Jamais « vérifié » sans niveau ; un contrôle fait sur le code seul est **annoncé comme tel**.
5. **Hôtes de dev seulement** (`localhost`, `127.0.0.1`). Toute autre URL demande l'accord explicite du développeur, puis `--autoriser-prod` (débit limité, `robots.txt` respecté). Rappeler qu'une prod ne montre la correction qu'après déploiement.
6. **Rien d'inventé** : chaque statut s'appuie sur une preuve observée (balise lue, valeur extraite, sortie de `auditer`, ligne de code).
7. **Jamais de commit ni de push**, jamais d'écriture en base, dans un CMS ou en production.

## Niveaux, par ordre de préférence

1. **`navigateur`** : outils MCP Chrome DevTools présents dans la session (noms contenant `chrome-devtools`). Pour chaque page du lot :
   - `navigate_page` sur l'URL de dev, puis lire le **HTML rendu** avec `evaluate_script` (`document.documentElement.outerHTML`, ou directement `document.title`, `meta[name=description]`, `link[rel=canonical]`, `meta[name=robots]`, `html[lang]`, `link[rel=alternate][hreflang]`, `meta[property^="og:"]`, niveaux et nombre de `h1`–`h6`, `img` sans `alt` ou sans `width`/`height`) ; `take_snapshot` pour l'arbre lisible si utile ;
   - **JSON-LD extrait** par `evaluate_script` : contenu de chaque `script[type="application/ld+json"]`, passé à `JSON.parse` dans la page ; noter les blocs qui ne parsent pas, les `@type`, et toute présence d'`AggregateRating` / `Review` dans l'arbre (`@graph`, objets imbriqués, `@type` en tableau) ;
   - `lighthouse_audit` limité à la catégorie **SEO** si l'outil est présent : score et audits en échec, rapportés à part (ce ne sont pas des ids du catalogue) ;
   - compléter par `auditer --url` (niveau 2) quand c'est possible : il donne les constats du catalogue et le **HTML brut**, celui que voient les robots et aperçus qui n'exécutent pas le JavaScript.
2. **`http`** : `auditer`, sans exécution du JavaScript, en disant le mode :
   - `--url <dev>` : HTML servi (codes HTTP, `robots.txt`, `sitemap.xml` compris) ;
   - `--dossier` : fichiers HTML lus tels quels, pour `html-statique` (`<racine>`) ou un `dist/` **existant** de `vue-spa`.
3. **`code`** : relire les fichiers source du lot (`fichier_source` de l'audit, fichiers du diff) contre les règles de `references/controles.md` et `references/stacks/<stack>.md`. Les contrôles qui demandent le rendu (liens cassés, pages orphelines, doublons entre pages, sitemap face aux pages servies) sont marqués **non vérifiables au niveau code**.

## Déroulé

1. **Contexte.** Lire `.claude/seo/profil.md` (stack, `urls.dev`, `pages`) et `.claude/seo/audit.json` : ce sont les constats **avant**. Délimiter le lot : pages et ids de contrôles transmis par le skill appelant, ou, appelé directement, ceux que le développeur désigne (à défaut, tout l'audit). Sans `audit.json`, pas de comparaison possible : relever les constats actuels et le dire. Lire `references/controles.md` et `references/stacks/<stack>.md`.
2. **Outils de la session.** Noter si des outils MCP Chrome DevTools sont présents et si Node répond. Choisir le niveau le plus haut atteignable ; ne jamais en annoncer un qui n'a pas été atteint.
3. **Atteindre la page selon la stack** (mêmes règles que l'étape 3 de `seo`) :
   - `html-statique` : `auditer --dossier <racine>` ; avec une URL de dev ou le navigateur, le niveau monte d'autant ;
   - `vue-spa` : URL de dev donnée ou serveur de dev **déjà lancé** par le développeur → navigateur (HTML rendu) **et** `auditer --url` (HTML brut) ; sinon `auditer --dossier <racine>/dist` **seulement si `dist/` existe**, en vérifiant qu'il est **plus récent que les fichiers modifiés par le lot** : un `dist/` antérieur ne montre pas la correction, le dire et ne pas le compter comme vérification. Sinon demander au développeur de construire ou de donner une URL de dev ; **ne jamais construire soi-même** ;
   - `php` : URL de dev du projet, ou proposer `php -S 127.0.0.1:<port>` et, **avec accord**, le lancer en arrière-plan. **Arrêter ce serveur dès la fin de la vérification, contrôler qu'il est bien arrêté** (le port ne répond plus), et le dire dans le résumé ;
   - `twig` : seulement avec une URL de dev donnée (navigateur ou `auditer --url`) ; sinon niveau `code`.
4. **Relever les constats après**, sur les pages du lot, au niveau atteint ; `auditer` couvre tout le site exploré, garder ses constats tels quels.
5. **Comparer par id.** Un constat est identifié par son `controle` (id du catalogue) et chacune de ses `pages`, comparées sur le chemin de l'URL (`pathname`, sans domaine ni barre finale). Pour chaque paire :
   - **corrigé** : présent avant, absent après ;
   - **restant** : présent avant et après (préciser si la preuve a changé, ex. title présent mais encore trop long) ;
   - **nouveau** : absent avant, présent après, sur une page du lot ou ailleurs : **régression** probable à signaler en tête. Si l'audit avant a été fait à un niveau plus bas (code seul, ou HTML brut face au rendu), dire que le constat peut être seulement devenu visible, et à confirmer ;
   - **non vérifié** : contrôle du lot que le niveau atteint ne permet pas d'observer, avec la raison.
6. **SPA : rendu et brut.** Pour `vue-spa`, rapporter les deux vues quand elles sont disponibles : ce que montre le navigateur après exécution du JavaScript, et ce que reçoivent les robots sans JavaScript (HTML brut, `T-SPA-HTML-VIDE`). Une meta posée par route n'est **vérifiée pour les robots sans JavaScript** que si elle figure dans le HTML brut.
7. **Résumer**, sans rien écrire :
   - niveau atteint (et mode : URL de dev, dossier, `dist/` daté, code seul), serveur lancé et arrêté le cas échéant ;
   - régressions d'abord, puis tableau par paire : `controle`, page, statut (`corrigé`, `restant`, `nouveau`, `non vérifié`), preuve avant, preuve après ;
   - JSON-LD extrait (types, blocs invalides, types interdits) et score Lighthouse SEO avec ses audits en échec, si le navigateur a servi ;
   - ce qui reste à faire et le skill qui le porte (`seo-technique`, `seo-contenu`, `seo-donnees-structurees`), sans rien corriger.

   Le skill appelant reprend ce résumé dans sa clôture (**vérifié**, et comment).
