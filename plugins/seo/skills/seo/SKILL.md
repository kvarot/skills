---
name: seo
description: Use when a developer wants a whole-site SEO (or GEO, AI answer engines) review of a web project, or the request is broad - why the site isn't found on Google, is it indexable, what to fix before going live, audit and fix. Entry point - detects the stack, builds the profile, audits, ranks fix batches and hands them to the specialised seo skills. For one targeted fix prefer - titles, meta descriptions, alt, headings texts -> seo-contenu; schema.org, JSON-LD -> seo-donnees-structurees; sitemap, robots.txt, canonical, hreflang, lang -> seo-technique; checking fixes on the rendered page -> seo-verification. Triggers - "fais un audit SEO de mon site", "améliore le référencement de ce projet", "mon site n'apparaît pas sur Google", "prépare le site pour le référencement avant la mise en ligne", "is my app indexable?", "SEO audit and fix". Not for paid ads, backlinks, rank tracking, competitor analysis, visual redesign or performance unrelated to search.
---

# SEO : point d'entrée

Corrige le SEO **dans le code du projet**, à l'endroit d'où vient le défaut, avec les conventions du projet. Ce skill détecte, profile, audite, priorise, puis confie chaque lot au skill spécialisé.

Outils : `node <base du skill>/../../outils/seo.mjs <commande>` (`<base du skill>` = dossier de base affiché au chargement de ce skill). Si Node manque, continuer en lisant le code et **le dire** dans chaque résumé.

## Règles qui ne plient pas

1. **Les règles du projet priment** (CLAUDE.md, conventions, style) sur ce plugin. Les lire avant tout.
2. **Rien n'est écrit sans validation explicite du lot.** Avant, seuls `.claude/seo/profil.md`, `.claude/seo/audit.json` et `.claude/seo/contenus-a-saisir.md` peuvent être écrits. Ni build, ni installation, ni serveur lancé sans accord.
3. **Rien d'inventé** : ni chiffre, ni promesse, ni avis client, ni note, ni certification, ni prix. Une affirmation non tirée du projet est signalée, jamais écrite.
4. **Aucune pratique pénalisable** : bourrage de mots-clés, texte caché, données structurées trompeuses (faux avis, `AggregateRating` sans avis réels), cloaking, pages satellites.
5. **Pas de refonte d'architecture** de sa propre initiative (SPA vers SSR, changement de framework) : expliquer, chiffrer l'impact, proposer des pistes, corriger ce qui peut l'être dans l'existant.
6. **Jamais d'écriture en base, dans un CMS distant ni en production.** Contenu en base ou CMS : `.claude/seo/contenus-a-saisir.md`. Lecture de la prod (pages publiques, `robots.txt`, `sitemap.xml`, Lighthouse) seulement après accord explicite du développeur, avec `--autoriser-prod`, à débit limité.
7. **Jamais de commit ni de push.**
8. **Aucun nom de projet privé** dans ce que le plugin produit pour d'autres projets (exemples, références).

## Déroulé

1. **Détecter et lire le profil.** `seo.mjs detecter <racine>`. Si `rendu` vaut `aucun` : répondre « non applicable » : aucune page publique détectée, ou stack non couverte en v1 (la nommer si elle est reconnaissable) ; s'arrêter. Lire `.claude/seo/profil.md` ; s'il manque, si `profil-valider` le refuse, ou s'il est périmé (stack, rendu ou langues différents de `detecter`, ou le développeur le dit), appeler `seo-profil`. Si `secteur` vaut `sante` et `pays` vaut `FR`, signaler une fois par session, en deux ou trois phrases sans alarmisme : les textes de déontologie interdisent tout procédé visant un référencement prioritaire (art. R. 4321-123, II pour les masseurs-kinésithérapeutes ; commentaire du CNOM sur l'article 19-1 pour les médecins) ; leur portée pour le référencement naturel n'est pas tranchée par ces textes ; le praticien peut la vérifier auprès de son conseil départemental de l'ordre ; détail et sources dans `references/secteurs/sante.md`. Puis continuer.
2. **Outils de la session.** Navigateur : outils MCP Chrome DevTools présents ou non. Search Console / Bing Webmaster : la proposer **seulement si un outil de connecteur est présent dans la session** ; ne rien interroger sans accord. Sinon n'en pas parler, tout fonctionne sans.
3. **Auditer selon la stack** (lire `references/controles.md` et `references/stacks/<stack>.md`) :
   - `html-statique` : `auditer --dossier <racine>` ;
   - `vue-spa` : `auditer --dossier <racine>/dist` **seulement si `<racine>/dist/` existe** (`<racine>` = racine du projet) ; sinon demander au développeur de construire ou de donner une URL de dev, **ne jamais construire soi-même** ;
   - `php` : proposer `php -S 127.0.0.1:<port>` (ou l'URL de dev du projet) et, **avec accord**, le lancer en arrière-plan puis `auditer --url` dessus. **Arrêter ce serveur dès la fin de l'audit ou de la vérification, contrôler qu'il est bien arrêté** (le port ne répond plus), et le dire dans le résumé ;
   - `twig` : lecture du code contre le catalogue et `stacks/twig.md`, sauf si une URL de dev est donnée (`auditer --url`).

   Hôtes `localhost` / `127.0.0.1` seulement ; toute autre URL demande l'accord du développeur puis `--autoriser-prod`. **Toujours annoncer le niveau atteint** : dossier, URL, ou lecture seule du code. Pour chaque constat, retrouver le fichier source et la correction ; écrire `.claude/seo/audit.json` (`references/audit-schema.md`) avec `date` du jour et `stack` = chaîne `stack` de `detecter`. Au-delà de 10 templates ou types de page, répartir les templates sur des agents `auditeur-seo` en parallèle.
4. **Présenter la liste priorisée des lots** (impact = somme des `priorite`, effort estimé : un layout partagé = faible, une page à la fois = fort ; tri par impact / effort), avec pour chacun ses constats, ses pages et le skill qui le porte :
   - `seo-technique` : les mécanismes (helper ou bloc de meta, canonical, robots, sitemap, hreflang, `lang`, balisage Open Graph, `width`/`height` des images, liens, explication des défauts d'architecture) : lots meta, indexation, international, partage, structure, images, liens, performance, architecture ;
   - `seo-contenu` : toute valeur de texte (title, description, libellé des Hn, alt, ancres, FAQ, pages pauvres) : lot contenu, contrôles `C-*`, et les textes des autres lots ;
   - `seo-donnees-structurees` : tout JSON-LD (lot donnees-structurees) ;
   - un lot meta qui demande mécanisme et textes passe par `seo-technique` puis `seo-contenu`, **dans un seul lot validé**.

   Ne rien écrire.
5. **Le développeur choisit les lots.** Appeler le ou les skills du lot par leur nom. Chaque lot suit : diff + justification + avant/après des textes → validation → écriture → `seo-verification`.
6. **Clore.** Ajouter le lot à `historique` du profil (date, lot, ids de contrôles) si ce lot de cette session n'y figure pas déjà, relancer `profil-valider`, puis résumer : **fait**, **vérifié** (et comment : navigateur, HTTP, ou code seul annoncé comme tel), **restant**.

Les skills spécialisés sont appelables directement ; ils lisent le profil et passent par `seo-profil` s'il manque.
