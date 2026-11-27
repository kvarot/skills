---
name: geo-technique
description: Use when the question is about how AI crawlers and answer engines can reach a site - robots.txt rules for GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, a CDN or WAF challenge blocking bots, pages empty without JavaScript, noindex, sitemaps, canonical, hreflang, llms.txt. Reads the robots verdicts and technical findings of the geo audit and explains them without recomputing. Triggers - "est-ce que mon robots.txt bloque ChatGPT ?", "GPTBot et OAI-SearchBot peuvent-ils lire mon site ?", "Cloudflare bloque-t-il les robots IA sur mon site ?", "can Perplexity crawl my site?", "/geo technical". Not for classic Google SEO fixes in templates (seo-technique of the seo plugin).
---

# GEO : accès technique des moteurs IA

Lire d'abord `<base du skill>/../../references/robots-ia.md` et, pour chaque constat cité, sa fiche dans `<base du skill>/../../references/constats.md`. Outils : `node <base du skill>/../../outils/geo.mjs <commande>`, **une commande `node` seule par appel**, sans `cd` ni enchaînement.

Si ce n'est pas déjà fait dans cette session, lancer d'abord `node <base du skill>/../../outils/geo.mjs init` (il efface tout accord réseau resté d'une session précédente).

## Règles qui ne plient pas

1. **Aucune lecture du site hors de `geo.mjs`** : ni WebFetch, ni navigateur, ni `curl`. L'hôte doit avoir été accepté dans la session (skill `geo` : `init`, liste des hôtes, oui explicite, puis `geo.mjs autoriser <hôte>`). `--hotes-autorises` et `--autoriser-local` sont **interdites au modèle**. Code de sortie 3 = demander l'accord, jamais contourner.
2. **Jamais recommander d'autoriser les robots d'entraînement.** Décrire la politique observée, rôle par rôle ; la décision revient au propriétaire.
3. **`llms.txt` est informatif**, poids 0 dans tout score, jamais présenté comme levier.
4. **Interpréter, ne pas recalculer** : le verdict par robot vient de l'outil (RFC 9309) ; ne pas relire le `robots.txt` à la main pour le contredire.
5. Un **défi WAF** (`GEO-WAF-DEFI`) se dit tel quel : la page n'a pas été lue, rien n'est conclu sur son contenu.

## Déroulé

1. Vérification rapide des robots : `geo.mjs robots --url <url>`. Présenter un tableau `jeton | éditeur | rôle | politique | groupe` ; séparer les rôles `indexation` et `consultation-utilisateur` (ce qui touche la présence dans les réponses) de `entrainement`, `controle` et `autre` (robots hors catégories et jetons non documentés).
2. Audit technique complet : reprendre l'audit du skill `geo` s'il existe (`geo.mjs rapport --audit <id> --format json`), sinon le faire lancer par `geo` (profil, accord, niveau). Les constats utiles : catégories indexation, accès IA, rendu, sitemaps, canonical, hreflang.
3. Pour chaque constat : gravité, preuve (`type`, `url`, `detail` : la commande ou la valeur qui la redonne), correction type de la fiche. Au niveau d'autonomie 1, aucune recommandation.
4. Rappeler les limites : un `robots.txt` inaccessible (5xx) vaut interdiction par précaution ; certains robots de consultation peuvent ne pas appliquer `robots.txt` (`robots-ia.md`).

Corrections dans le code : **prévu en 0.3** (`fix`) ; si le plugin `seo` est installé, l'utilisateur peut lui confier les corrections SEO classiques.
