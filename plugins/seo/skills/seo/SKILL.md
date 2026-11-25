---
name: seo
description: Use when a developer wants the SEO (search engine optimisation) or GEO (visibility in AI answer engines) of a web project audited and fixed in its own code - why the site is not found on Google, whether pages are indexable, what to fix first before going live, a full SEO review of a PHP, Twig, static HTML or Vue site. Entry point - detects the stack, builds the project profile, audits, ranks fix batches and routes to seo-technique, seo-donnees-structurees, seo-contenu, seo-verification. Triggers - "fais un audit SEO", "améliore le référencement de mon site", "mon site n'apparaît pas sur Google", "prépare le site pour le référencement", "is my app indexable?", "SEO audit and fix". Not for paid ads (Google Ads), backlinks or netlinking, rank tracking, visual redesign or general performance/debugging unrelated to search.
---

# SEO : point d'entrée

Corrige le SEO **dans le code du projet**, à l'endroit d'où vient le défaut, avec les conventions du projet. Ce skill détecte, profile, audite, priorise, puis confie chaque lot au skill spécialisé.

Outils : `node <base du skill>/../../outils/seo.mjs <commande>` (`<base du skill>` = dossier de base affiché au chargement de ce skill). Si Node manque, continuer en lisant le code et **le dire** dans chaque résumé.

## Règles qui ne plient pas

1. **Les règles du projet priment** (CLAUDE.md, conventions, style) sur ce plugin. Les lire avant tout.
2. **Rien n'est écrit sans validation explicite du lot.** Avant, seuls `.claude/seo/profil.md`, `.claude/seo/audit.json` et `.claude/seo/contenus-a-saisir.md` peuvent être écrits.
3. **Rien d'inventé** : ni chiffre, ni promesse, ni avis client, ni note, ni certification, ni prix. Une affirmation non tirée du projet est signalée, jamais écrite.
4. **Aucune pratique pénalisable** : bourrage de mots-clés, texte caché, données structurées trompeuses (faux avis, `AggregateRating` sans avis réels), cloaking, pages satellites.
5. **Pas de refonte d'architecture** de sa propre initiative (SPA vers SSR, changement de framework) : expliquer, chiffrer l'impact, proposer des pistes, corriger ce qui peut l'être dans l'existant.
6. **Jamais d'écriture en base, dans un CMS distant ni en production.** Contenu en base ou CMS : `.claude/seo/contenus-a-saisir.md`. Lecture de la prod (pages publiques, `robots.txt`, `sitemap.xml`, Lighthouse) seulement après accord explicite du développeur, avec `--autoriser-prod`, à débit limité.
7. **Jamais de commit ni de push.**
8. **Aucun nom de projet privé** dans ce que le plugin produit pour d'autres projets (exemples, références).

## Déroulé

1. **Détecter et lire le profil.** `seo.mjs detecter <racine>`. Si `rendu` vaut `aucun` : répondre « non applicable » (aucune page publique produite), dire pourquoi, s'arrêter. Lire `.claude/seo/profil.md` ; s'il manque, si `profil-valider` le refuse, ou s'il est périmé (stack, rendu ou langues différents de `detecter`, ou le développeur le dit), appeler `seo-profil`.
2. **Outils de la session.** Navigateur : outils MCP Chrome DevTools présents ou non. Search Console / Bing Webmaster : la proposer **seulement si un outil de connecteur est présent dans la session** ; ne rien interroger sans accord. Sinon n'en pas parler, tout fonctionne sans.
3. **Auditer.** Toujours le code : `seo.mjs auditer --dossier <dossier rendu>` (pour `vue-spa`, le dossier construit, ex. `dist/`). Rendu réel si une URL de dev existe : `auditer --url <dev>` (`localhost`, `127.0.0.1`) ; toute autre URL demande l'accord du développeur puis `--autoriser-prod`. Lire `references/controles.md` et `references/stacks/<stack>.md`, retrouver pour chaque constat le fichier source et la correction, écrire `.claude/seo/audit.json` (`references/audit-schema.md`). Au-delà de 8 templates ou types de page, répartir les templates sur des agents `auditeur-seo` en parallèle.
4. **Présenter la liste priorisée des lots** : un lot = un type de correction (`lot` des constats : meta, indexation, international, partage, structure, images, liens, performance, architecture, donnees-structurees, contenu). Pour chacun : constats, pages, impact (somme des `priorite`), effort estimé (un layout partagé = faible ; une page à la fois = fort), skill qui le traitera. Trier par impact / effort. Ne rien écrire.
5. **Le développeur choisit les lots.** Pour chacun, appeler le skill spécialisé par son nom :
   - `seo-technique` : meta (balises, helper, canonical), indexation, international, partage, structure, images, liens, performance, architecture ;
   - `seo-donnees-structurees` : donnees-structurees (schema.org, JSON-LD) ;
   - `seo-contenu` : textes (title, description, Hn, alt, ancres, FAQ, pages pauvres) ;
   - puis `seo-verification` sur ce qui a été écrit.
   Chaque lot suit : diff + justification + avant/après des textes → validation → écriture → vérification.
6. **Clore.** Ajouter le lot à `historique` du profil (date, lot, ids de contrôles), puis résumer : **fait**, **vérifié** (et comment : navigateur, HTTP, ou code seul annoncé comme tel), **restant**.

Les skills spécialisés sont appelables directement ; ils lisent le profil et passent par `seo-profil` s'il manque.
