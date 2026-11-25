---
name: seo-technique
description: Use when a technical SEO mechanism of a web project must be added or fixed in the code - sitemap.xml, robots.txt, robots meta / noindex, canonical, hreflang, html lang attribute, the meta helper or block where title and description are emitted, Open Graph tags markup, img width/height, broken internal links, orphan pages - or when a SPA serves an empty HTML shell to crawlers. Also runs the technical part of a fix batch chosen in the seo entry skill. Triggers - "génère un sitemap.xml et un robots.txt", "corrige le canonical et les hreflang du layout", "ajoute l'attribut lang", "la page est en noindex", "mes pages Vue sont vides pour Google", "fix the canonical tags in my base template". Not for writing title, description, alt or heading texts (seo-contenu), JSON-LD / schema.org (seo-donnees-structurees), a whole-site audit (seo), general page speed or Lighthouse performance score, ads or backlinks.
---

# SEO : corrections techniques

Pose ou répare les **mécanismes** : là où naissent title et description (helper, bloc, en-tête partagé, meta de route), canonical, meta robots et `robots.txt`, `sitemap.xml`, hreflang, `lang`, balisage Open Graph, `width`/`height` des images, liens internes, et l'explication des défauts d'architecture. Il n'écrit **aucune valeur de texte** : titles, descriptions, libellés de Hn, alt, ancres et FAQ sont à `seo-contenu`. Le JSON-LD est à `seo-donnees-structurees`.

Outils : `node <base du skill>/../../outils/seo.mjs <commande>` (`<base du skill>` = dossier de base affiché au chargement de ce skill). Si Node manque, travailler en lisant le code et **le dire** dans le résumé.

## Règles qui ne plient pas

1. **Les règles du projet priment** (CLAUDE.md, conventions, style) : les lire avant tout.
2. **Rien n'est écrit sans validation explicite du lot.** Avant, seuls `.claude/seo/profil.md`, `.claude/seo/audit.json` et `.claude/seo/contenus-a-saisir.md` peuvent être écrits. Ni build, ni installation, ni serveur lancé sans accord.
3. **Rien d'inventé.** Pas de texte rédigé ici : un mécanisme se branche sur les valeurs existantes ou attend celles de `seo-contenu`. Pas d'URL, de domaine ni d'identifiant de route deviné : les demander.
4. **Aucune pratique pénalisable** : pas de texte caché, de cloaking (HTML différent pour les robots), de pages satellites, de canonical vers une autre page pour masquer un doublon.
5. **Pas de refonte d'architecture** : pas de passage en SSR, pas de changement de framework, **pas de dépendance de rendu ajoutée** (pré-rendu, SSR, bibliothèque de `<head>`) de sa propre initiative.
6. **Jamais d'écriture en base, dans un CMS distant ni en production** ; jamais de commit ni de push. Lecture de la prod seulement avec accord et `--autoriser-prod`.
7. **Aucun nom de projet privé** dans ce que le skill produit pour d'autres projets.

## Déroulé

1. **Contexte.** Lire `.claude/seo/profil.md` ; s'il manque ou si `profil-valider` le refuse, appeler `seo-profil`. Lire `.claude/seo/audit.json` ; s'il manque et que la demande dépasse un seul fichier désigné, appeler `seo` pour l'audit. Lire `references/controles.md` (ids, lot, correction type) et `references/stacks/<stack>.md`.
2. **Localiser la source.** Pour chaque constat du lot, partir de la page (`pages` de l'audit, ou `pages` du profil) et remonter au fichier source selon la section « Relier une URL à sa source » de la stack : layout ou bloc Twig, en-tête PHP inclus, fichier HTML, route Vue. Corriger à la source, jamais dans une sortie construite (`dist/`, cache).
3. **Réutiliser l'existant.** Chercher d'abord le mécanisme déjà en place (helper de meta, bloc `head`, variable posée avant l'`include`, `meta` de route, bibliothèque de `<head>` déjà installée, script de sitemap) et l'étendre. N'en créer un que s'il n'existe pas, dans le style du projet.
4. **Mécanismes et textes.** Un lot meta qui demande mécanisme et textes se fait **dans un seul lot validé** : ce skill pose le mécanisme (bloc, variable, repli), puis passe la main à `seo-contenu` pour les valeurs. Tant qu'elles manquent, brancher le mécanisme sur les valeurs existantes du projet (title actuel, nom du site déjà présent) ; ne jamais écrire de texte de remplacement inventé.
5. **Par famille de contrôles :**
   - **Indexation** : retirer `noindex` d'une page publique seulement après confirmation qu'elle doit être trouvée ; `robots.txt` avec la ligne `Sitemap:` et sans `Disallow: /` hors zones privées ; `sitemap.xml` (statique ou généré selon la stack) aligné sur les pages publiques réelles, URL absolues sur le domaine du profil, sans URL privée. Routes dynamiques : demander les identifiants réels.
   - **Canonical** : URL absolue https sur le domaine du site ; sans domaine connu (`urls.prod` du profil ou configuration du projet), le demander.
   - **International** : `lang` réel sur `<html>` ; hreflang réciproques avec `x-default` dès deux langues, construits depuis la liste des locales du projet.
   - **Partage** : balises Open Graph alimentées par les mêmes variables que title et description, pas par un second texte.
   - **Images** : `width`/`height` tirés des dimensions réelles du fichier ; l'`alt` reste à `seo-contenu`.
   - **Liens** : corriger la cible d'un lien cassé d'après les pages existantes ; une page orpheline reçoit un lien depuis une page pertinente (l'ancre est rédigée par `seo-contenu`).
6. **Architecture (`T-SPA-HTML-VIDE`).** Expliquer pourquoi la coquille vide pénalise (robots et aperçus qui n'exécutent pas le JavaScript), chiffrer l'impact (pages publiques concernées, priorité de l'audit), présenter les pistes de `references/stacks/vue-spa.md` avec leur coût, **sans rien installer ni migrer**. Corriger quand même ce qui peut l'être dans l'existant : `lang`, title et description de `index.html`, meta par route, `robots.txt`, `sitemap.xml`, mode d'historique signalé.
7. **Présenter** le lot : diff par fichier, justification par constat (id du contrôle, page, preuve), ce qui reste à `seo-contenu` ou `seo-donnees-structurees`, et ce qui a été demandé au développeur. **Attendre la validation explicite.**
8. **Écrire** exactement ce qui a été validé, puis appeler `seo-verification` sur les pages du lot.
9. **Clore.** Ajouter le lot à `historique` du profil (date, lot, ids de contrôles traités) s'il n'y figure pas déjà, relancer `profil-valider`, résumer : **fait**, **vérifié** (et comment), **restant**.
