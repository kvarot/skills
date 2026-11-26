---
name: seo-profil
description: Use when the SEO profile of a web project (.claude/seo/profil.md) must be created, checked or updated - target audience, offer, tone of voice, languages, sector, country, main keywords per page type, terms to avoid - before any SEO text is written, or when the audience, languages or offer have changed. Also called by the other seo skills when the profile is missing or stale. Triggers - "crée le profil SEO", "mets à jour le profil SEO", "définis le ton et les mots-clés du site", "le public du site a changé", "update the SEO profile", "the site now also exists in English". Not for writing the texts themselves (seo-contenu) or auditing the site (seo).
---

# SEO : profil du projet

Construit ou met à jour `.claude/seo/profil.md`, la mémoire du plugin sur le site : ce qu'il est, pour qui, avec quel ton. Champs, types et exemple : `references/profil.md`. C'est le **seul** fichier que ce skill écrit.

Outils : `node <base du skill>/../../outils/seo.mjs <commande>`. **Une commande `node` seule par appel**, chemin complet, sans `cd` ni enchaînement (`&&`, `;`, `|`, `2>&1`) : une session peut n'autoriser que `node`. Les références (`references/…`) sont dans `<base du skill>/../../references/`, à lire avec l'outil de lecture. Si Node manque, faire le travail en lisant le code, vérifier le profil à la main contre `references/profil.md`, et le dire.

Les règles du projet (CLAUDE.md, conventions) priment sur ce skill.

## Déroulé

1. **Technique (déduit).** `seo.mjs detecter <racine>` → `stack`, `rendu`, `langues`, fichiers clés. `outils.navigateur` : `oui` si des outils MCP Chrome DevTools sont présents dans la session. `outils.search_console` : `oui` seulement si un connecteur est présent **et** que le développeur accepte de l'utiliser. URL de dev et de prod : seulement si le développeur les donne ou si le projet les déclare (configuration, canonical absolu, `url` ou `@id` du JSON-LD, `sitemap.xml`, ligne `Sitemap:` de `robots.txt`) ; noter dans le profil le fichier d'où vient `urls.prod`.
2. **Discours (déduit, jamais inventé).** Lire la page d'accueil (template ou HTML), le README, les textes de l'interface (fichiers de traduction, templates, composants), les contenus existants. En tirer une proposition de `public`, `offre`, `ton`, `secteur`, `pays`, `mots_cles` par type de page, `termes_a_eviter`, **en citant pour chaque valeur le fichier d'où elle vient**. Ce qui ne se déduit pas est demandé, pas deviné.
3. **Faire confirmer.** Présenter la proposition en une liste courte et demander une confirmation **explicite**. Une correction du développeur est reprise puis reconfirmée. Une confirmation explicite donnée d'avance pour la proposition (« le profil que tu proposes est confirmé tel quel ») vaut ce « oui » : présenter la proposition dans la réponse, puis écrire. Sans « oui » clair, ne pas écrire `confirme_le` (le profil reste invalide et aucun contenu rédigé ne sera proposé). **Ne jamais remplir `confirme_le` ni un champ confirmé (public, offre, ton, secteur, pays) pour satisfaire le validateur** : redemander au développeur.
4. **Écrire** `.claude/seo/profil.md` : front matter selon `references/profil.md`, `confirme_le` = date du jour de la confirmation. En mise à jour : ne changer que les champs concernés, garder `historique`, `pages` et les notes ; si public, offre, ton, secteur ou pays changent, refaire l'étape 3 et dater à nouveau.
5. **Valider**, après chaque écriture (mise à jour de l'historique comprise). `seo.mjs profil-valider .claude/seo/profil.md` : code 0 = valide ; 1 = corriger chaque erreur listée (une erreur sur un champ confirmé se règle en redemandant, voir étape 3) et relancer ; 2 ou 3 = signaler le problème d'appel ou de lecture.
6. **Secteur.** `secteur: sante` active `references/secteurs/sante.md` : le signaler au développeur. Pays hors France : la partie générique s'applique, le droit local reste à vérifier.

Un profil est **périmé** quand `stack`, `rendu` ou `langues` ne correspondent plus à `detecter`, ou quand le développeur dit que le site a changé : le mettre à jour ainsi.
