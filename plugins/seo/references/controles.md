# Catalogue des contrôles SEO (v1)

Chaque contrôle a un identifiant stable, une sévérité (`bloquant` pèse 3, `important` 2, `mineur` 1), un lot de correction et une règle. La priorité d'un constat vaut `poids × nombre de pages concernées`. Les identifiants `T-` sont techniques, `C-` portent sur le contenu.

Ce tableau est vérifié par `evals/test-outils.mjs` : ses identifiants doivent être exactement ceux de `CATALOGUE` dans `outils/controler.mjs`.

| id | sévérité | lot | règle | correction type | source |
|---|---|---|---|---|---|
| T-TITLE-ABSENT | bloquant | meta | pas de title ou vide | Ajouter un `<title>` unique et descriptif dans le `<head>` de chaque page. | https://developers.google.com/search/docs/appearance/title-link |
| T-TITLE-DOUBLON | important | meta | même title sur au moins 2 pages | Donner à chaque page un title propre à son contenu (service, ville, sujet). | https://developers.google.com/search/docs/appearance/title-link |
| T-TITLE-LONGUEUR | mineur | meta | hors 30–60 caractères | Réécrire le title entre 30 et 60 caractères, mot-clé principal en tête. | https://developers.google.com/search/docs/appearance/title-link |
| T-DESC-ABSENT | important | meta | pas de meta description | Ajouter `<meta name="description" content="…">` résumant la page en une ou deux phrases. | https://developers.google.com/search/docs/appearance/snippet |
| T-DESC-DOUBLON | important | meta | même description sur au moins 2 pages | Rédiger une description différente par page. | https://developers.google.com/search/docs/appearance/snippet |
| T-DESC-LONGUEUR | mineur | meta | hors 70–160 caractères | Ramener la description entre 70 et 160 caractères pour éviter la troncature. | https://developers.google.com/search/docs/appearance/snippet |
| T-CANONICAL-ABSENT | mineur | meta | pas de canonical | Ajouter `<link rel="canonical" href="https://…">` pointant vers l'URL de référence de la page. | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| T-CANONICAL-INVALIDE | important | meta | canonical relatif ou vers autre domaine | Utiliser une URL absolue (https) sur le domaine du site. | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| T-ROBOTS-NOINDEX | bloquant | indexation | `noindex` sur une page publique | Retirer `noindex` de la meta robots (ou de l'en-tête `X-Robots-Tag`) si la page doit être trouvée. | https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag |
| T-ROBOTSTXT-ABSENT | mineur | indexation | `robotsTxt` absent | Publier un `/robots.txt` à la racine, avec la ligne `Sitemap:`. | https://developers.google.com/search/docs/crawling-indexing/robots/intro |
| T-ROBOTSTXT-BLOQUE-TOUT | bloquant | indexation | `Disallow: /` pour `User-agent: *` | Supprimer le `Disallow: /` (ou le limiter aux zones privées) avant mise en ligne. | https://developers.google.com/search/docs/crawling-indexing/robots/intro |
| T-SITEMAP-ABSENT | important | indexation | sitemap absent | Générer un `sitemap.xml` listant les pages publiques et le déclarer dans robots.txt. | https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview |
| T-SITEMAP-INCOHERENT | mineur | indexation | page connue absente du sitemap, ou URL du sitemap inconnue | Aligner le sitemap sur les pages réellement publiées : ajouter les manquantes, retirer les URL mortes. | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap |
| T-HREFLANG-INCOHERENT | important | international | hreflang sans réciproque ou sans `x-default` quand au moins 2 langues | Faire déclarer chaque variante par toutes les autres, et ajouter une entrée `x-default`. | https://developers.google.com/search/docs/specialty/international/localized-versions |
| T-LANG-ABSENT | important | international | pas d'attribut `lang` | Ajouter `lang="fr"` (ou la langue réelle) sur `<html>`. | https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang |
| T-OG-ABSENT | mineur | partage | `og:title` ou `og:description` absent | Ajouter les balises Open Graph `og:title`, `og:description` (et `og:image`). | https://ogp.me/ |
| T-H1-ABSENT | important | structure | aucun h1 | Ajouter un `<h1>` unique décrivant le sujet de la page. | https://web.dev/learn/html/headings-and-sections |
| T-H1-MULTIPLE | mineur | structure | plus d'un h1 | Ne garder qu'un `<h1>` et rétrograder les autres en `<h2>`. | https://web.dev/learn/html/headings-and-sections |
| T-HN-SAUT | mineur | structure | saut de niveau (h2 puis h4) | Respecter la hiérarchie : ne pas sauter de niveau entre deux titres. | https://web.dev/learn/html/headings-and-sections |
| T-ALT-ABSENT | important | images | `alt` absent | Renseigner `alt` (texte descriptif, ou `alt=""` si l'image est décorative). | https://developers.google.com/search/docs/appearance/google-images |
| T-IMG-DIMENSIONS | mineur | performance | img sans `width` et `height` | Déclarer `width` et `height` pour réserver la place et éviter les décalages de mise en page. | https://web.dev/articles/optimize-cls |
| T-LIEN-CASSE | important | liens | lien interne vers URL inconnue | Corriger la cible du lien ou rétablir la page (ou ajouter une redirection). | https://developers.google.com/search/docs/crawling-indexing/links-crawlable |
| T-PAGE-ORPHELINE | mineur | liens | page connue sans lien entrant | Ajouter un lien interne depuis une page pertinente (menu, page liée). | https://developers.google.com/search/docs/crawling-indexing/links-crawlable |
| T-SPA-HTML-VIDE | bloquant | architecture | `corpsVide` | Servir du HTML avec le contenu (rendu serveur ou pré-rendu) au lieu d'une coquille vide. | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics |
| T-JSONLD-INVALIDE | important | donnees-structurees | JSON-LD non parsable ou sans `@type` | Corriger la syntaxe JSON et déclarer un `@type` schema.org. | https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data |
| T-JSONLD-INTERDIT | bloquant | donnees-structurees | `AggregateRating` ou `Review` présent | Retirer ces types, sauf si de vrais avis vérifiables sont visibles sur la page. | https://developers.google.com/search/docs/appearance/structured-data/review-snippet |
| C-PAGE-PAUVRE | mineur | contenu | moins de 300 mots visibles | Enrichir la page avec un contenu utile et propre à elle, ou la fusionner avec une page voisine. | https://developers.google.com/search/docs/fundamentals/creating-helpful-content |
| C-ANCRE-GENERIQUE | mineur | contenu | ancre « cliquez ici », « ici », « en savoir plus », « lire la suite », « click here », « here », « read more » | Remplacer l'ancre par un texte qui décrit la page cible. | https://developers.google.com/search/docs/crawling-indexing/links-crawlable |

## Notes de lecture

- La comparaison entre sitemap et pages se fait sur le chemin (`pathname`) de l'URL.
- Sans `origine` connue, T-CANONICAL-INVALIDE ne signale que les canonicals relatifs.
- T-JSONLD-INTERDIT cherche `AggregateRating` et `Review` dans tout l'arbre JSON-LD (imbriqué, `@graph`, `@type` en tableau). Vocabulaire : https://schema.org/AggregateRating
