# Catalogue des constats techniques et d'accès IA

Ce fichier documente chaque identifiant de constat du plugin. Il est la contrepartie lisible de `CATALOGUE` (`outils/lib/controles.mjs`) : un test vérifie que les deux listent les mêmes identifiants, avec la même gravité.

Format (à respecter pour tout nouvel identifiant) : un titre `### GEO-XXX`, puis une ligne `**Gravité** : <bloquant|important|mineur|information>`, puis description, preuve attendue, correction type et, quand il en existe une, la source officielle (seulement celles du benchmark, sections 2.1 à 2.6).

Chaque constat porte une preuve `{ type, url, detail }` reproductible. Quand une commande permet de rejouer la vérification sur un site en ligne, elle est dans un champ séparé `preuve.commande` : texte écrit par l'outil (jamais du texte de page), de la forme `curl -sI '<url>'`, 512 caractères au plus, les parties issues de la page (URL, nom recherché) encodées en pourcentage ; le rapport Markdown l'affiche dans un bloc de code, à copier telle quelle. `detail` reste un extrait. En mode dossier, aucune commande n'est écrite : la preuve indique « mode dossier : fichier <chemin> ». Les extraits de pages sont limités, échappés et marqués `non_fiable`.

## indexation

### GEO-NOINDEX

**Gravité** : bloquant

- Catégorie : indexation ; classe : deterministe
- Description : Page exclue de l’index par une directive noindex (balise meta robots ou en-tête X-Robots-Tag). Portée : page de départ et pages listées dans le sitemap ; les autres pages en noindex relèvent du choix du propriétaire et ne sont pas signalées.
- Preuve attendue : http ou html : valeur de `x-robots-tag` (`preuve.commande` : `curl -sI '<url>'`) ou balise `<meta name="robots">` ; en mode dossier, le fichier à ouvrir.
- Correction type : Retirer `noindex` des pages qui doivent apparaître dans la recherche ; le conserver seulement sur les pages volontairement privées.
- Source officielle : https://developers.google.com/search/docs/appearance/ai-features

### GEO-ROBOTSTXT-BLOQUE-TOUT

**Gravité** : bloquant

- Catégorie : indexation ; classe : deterministe
- Description : Le robots.txt interdit tout le site à tous les robots (User-agent: * et Disallow: /).
- Preuve attendue : robots : le groupe `User-agent: *` contient `Disallow: /`.
- Correction type : Supprimer ou restreindre la règle `Disallow: /` (par exemple limiter à `/admin/`), sauf si le site est volontairement fermé.
- Source officielle : aucune dans le dossier de référence

### GEO-ROBOTSTXT-INACCESSIBLE

**Gravité** : bloquant

- Catégorie : indexation ; classe : deterministe
- Description : robots.txt répond par une erreur serveur (5xx) ou ne répond pas (erreur réseau, délai) : selon RFC 9309, tout le site est alors considéré interdit, et l’audit n’a lu aucune page.
- Preuve attendue : robots : statut de `/robots.txt` (5xx, ou 0 pour une absence de réponse) ; `preuve.commande` : `curl -sI '<origine>/robots.txt'`. Même cause, dans les scores, que GEO-ROBOTSTXT-BLOQUE-TOUT (critères `robots-txt-ouvert` et `recherche-non-bloquee`). Les sitemaps et `/llms.txt` ne sont alors pas lus : GEO-SITEMAP-ABSENT n'est pas émis et GEO-LLMSTXT dit « non vérifié ».
- Correction type : Faire répondre `/robots.txt` en 200 (fichier, même vide) ou en 404 s'il n'y a rien à interdire ; une erreur 5xx durable ferme le site aux robots qui suivent la norme.
- Source officielle : aucune dans le dossier de référence (la règle vient de RFC 9309)

### GEO-SITEMAP-ABSENT

**Gravité** : important

- Catégorie : indexation ; classe : deterministe
- Description : Aucun sitemap trouvé (ni déclaré dans robots.txt, ni à /sitemap.xml). Non signalé quand les sitemaps n’ont pas pu être lus (interdits par robots.txt ou robots.txt inaccessible) : leur absence n'est alors pas établie, et le critère `sitemap-present` n'est pas calculé.
- Preuve attendue : sitemap : aucune ligne `Sitemap:` dans robots.txt et pas de fichier à `/sitemap.xml`.
- Correction type : Publier un sitemap XML des pages indexables et le déclarer dans robots.txt.
- Source officielle : aucune dans le dossier de référence

### GEO-SITEMAP-INCOHERENT

**Gravité** : mineur

- Catégorie : indexation ; classe : deterministe
- Description : Le sitemap liste des URL inutilisables : en erreur, en noindex, canoniques ailleurs, d’un autre hôte, ou sitemap illisible.
- Preuve attendue : sitemap : URL listées en erreur, en noindex, canoniques ailleurs ou d’un autre hôte ; ou sitemap illisible.
- Correction type : Ne lister dans le sitemap que des URL indexables qui répondent 200 et sont leur propre canonical.
- Source officielle : aucune dans le dossier de référence

### GEO-CANONICAL-ABSENT

**Gravité** : mineur

- Catégorie : indexation ; classe : deterministe
- Description : Page sans balise link rel=canonical.
- Preuve attendue : html : absence de `<link rel="canonical">`.
- Correction type : Ajouter un canonical absolu qui pointe vers l’URL préférée de la page.
- Source officielle : aucune dans le dossier de référence

### GEO-CANONICAL-AUTRE-HOTE

**Gravité** : important

- Catégorie : indexation ; classe : deterministe
- Description : La balise canonical pointe vers un autre hôte que celui de la page.
- Preuve attendue : html : valeur du canonical dont l’hôte diffère de celui de la page.
- Correction type : Corriger le canonical vers l’hôte du site, sauf syndication volontaire.
- Source officielle : aucune dans le dossier de référence

### GEO-HTTP-ERREUR

**Gravité** : important

- Catégorie : indexation ; classe : deterministe
- Description : URL du site répondant par une erreur HTTP 4xx ou 5xx.
- Preuve attendue : http : statut 4xx ou 5xx (`preuve.commande` : `curl -sI '<url>'`).
- Correction type : Réparer la page, rediriger vers un équivalent ou retirer les liens qui y mènent.
- Source officielle : aucune dans le dossier de référence

### GEO-REDIRECTION-CHAINE

**Gravité** : mineur

- Catégorie : indexation ; classe : deterministe
- Description : Chaîne de plus de 2 redirections avant la page finale.
- Preuve attendue : http : chaîne de plus de 2 redirections (`preuve.commande` : `curl -sIL '<url>'`).
- Correction type : Rediriger directement vers l’URL finale en un seul saut.
- Source officielle : aucune dans le dossier de référence

### GEO-PROFONDEUR

**Gravité** : mineur

- Catégorie : indexation ; classe : deterministe
- Description : Page à plus de 3 clics de la page de départ.
- Preuve attendue : calcul : profondeur de la page en clics depuis la page de départ.
- Correction type : Ajouter des liens internes depuis des pages proches de l’accueil.
- Source officielle : aucune dans le dossier de référence

### GEO-PAGE-ORPHELINE

**Gravité** : mineur

- Catégorie : indexation ; classe : deterministe
- Description : Page listée dans le sitemap mais sans aucun lien entrant depuis les pages explorées.
- Preuve attendue : sitemap : URL du sitemap sans lien entrant dans les pages explorées.
- Correction type : Relier la page depuis des pages pertinentes, ou la retirer du sitemap si elle n’a plus lieu d’être.
- Source officielle : aucune dans le dossier de référence

### GEO-CONTENU-DUPLIQUE

**Gravité** : important

- Catégorie : indexation ; classe : deterministe
- Description : Plusieurs URL avec le même texte visible et sans canonical commun.
- Preuve attendue : calcul : même empreinte du texte visible sur plusieurs URL, sans canonical commun.
- Correction type : Désigner une URL de référence par canonical, ou fusionner les pages (redirection 301).
- Source officielle : aucune dans le dossier de référence

## robots-ia

### GEO-ROBOTS-RECHERCHE-BLOQUE

**Gravité** : bloquant

- Catégorie : robots-ia ; classe : deterministe
- Description : Un robot d’indexation documenté (recherche) est bloqué par robots.txt sur des pages publiques.
- Preuve attendue : robots : jeton documenté de rôle `indexation` bloqué pour une page publique (évaluation RFC 9309).
- Correction type : Retirer la règle qui bloque le robot de recherche concerné, si le site veut apparaître dans ses réponses. Selon OpenAI, bloquer `OAI-SearchBot` rend le site absent des réponses de ChatGPT search.
- Source officielle : https://developers.openai.com/api/docs/bots

### GEO-ROBOTS-CONSULTATION-BLOQUE

**Gravité** : important

- Catégorie : robots-ia ; classe : deterministe
- Description : Un robot de consultation à la demande de l’utilisateur, documenté, est bloqué par robots.txt.
- Preuve attendue : robots : jeton documenté de rôle `consultation-utilisateur` bloqué.
- Correction type : Décision du propriétaire : lever le blocage si les assistants doivent pouvoir lire la page à la demande d’un utilisateur. Plusieurs éditeurs indiquent que robots.txt peut ne pas s’appliquer à ces robots.
- Source officielle : https://developers.openai.com/api/docs/bots

### GEO-ROBOTS-ENTRAINEMENT-POLITIQUE

**Gravité** : information

- Catégorie : robots-ia ; classe : deterministe
- Description : Politique observée dans robots.txt pour les robots d’entraînement documentés, sans recommandation.
- Preuve attendue : robots : liste des robots d’entraînement documentés bloqués et non bloqués.
- Correction type : Aucune : constat informatif. Le choix de bloquer ou non l’entraînement revient au propriétaire du site ; le plugin ne recommande jamais d’autoriser ces robots.
- Source officielle : aucune dans le dossier de référence

### GEO-WAF-DEFI

**Gravité** : bloquant

- Catégorie : robots-ia ; classe : deterministe
- Description : Un défi CDN / WAF bloque l’accès automatisé : les pages défiées ne sont pas analysées.
- Preuve attendue : http : statut 403 / 429 / 503 avec marqueur de défi (`cf-mitigated`, titre « Just a moment », challenge-platform, captcha).
- Correction type : Autoriser le trafic de vérification légitime (règle WAF pour l’agent `geo-audit`) ou fournir un export du site ; les pages défiées ne sont pas analysées.
- Source officielle : aucune dans le dossier de référence

### GEO-NOSNIPPET

**Gravité** : important

- Catégorie : robots-ia ; classe : deterministe
- Description : nosnippet ou max-snippet:0 empêche l’affichage d’extraits, donc la citation.
- Preuve attendue : html ou http : `nosnippet` ou `max-snippet:0` dans la meta robots ou `x-robots-tag`.
- Correction type : Retirer `nosnippet` / `max-snippet:0` des pages à rendre citables ; utiliser `data-nosnippet` pour exclure seulement un passage.
- Source officielle : https://developers.google.com/search/docs/appearance/ai-features

### GEO-LLMSTXT

**Gravité** : information

- Catégorie : robots-ia ; classe : deterministe
- Description : Présence ou absence de /llms.txt, ou « non vérifié » quand la requête a échoué (erreur réseau, 5xx) ou était interdite par robots.txt (information seulement, poids nul dans tout score).
- Preuve attendue : http : statut de `/llms.txt`. Constat d’information, poids nul dans tout score : sans effet démontré sur la visibilité ; Google déclare ne pas l’utiliser.
- Correction type : Aucune correction attendue ; ne pas présenter ce fichier comme un levier de visibilité.
- Source officielle : https://developers.google.com/search/docs/fundamentals/ai-optimization-guide

### GEO-CONTENT-SIGNAL

**Gravité** : information

- Catégorie : robots-ia ; classe : deterministe
- Description : Directive Content-Signal relevée dans robots.txt (valeur brute, non évaluée).
- Preuve attendue : robots : valeur brute de la ligne `Content-Signal:` (non évaluée).
- Correction type : Aucune : constat informatif.
- Source officielle : aucune dans le dossier de référence

## rendu

### GEO-HTML-VIDE

**Gravité** : bloquant

- Catégorie : rendu ; classe : deterministe
- Description : Le HTML reçu n’a quasiment pas de texte (page rendue côté client ou coquille vide), hors défi WAF.
- Preuve attendue : html : moins de 20 mots de texte visible dans le HTML reçu.
- Correction type : Fournir le contenu dans le HTML initial (rendu serveur ou pré-rendu) ; les robots qui n’exécutent pas JavaScript ne voient que la coquille.
- Source officielle : aucune dans le dossier de référence

### GEO-VIEWPORT-ABSENT

**Gravité** : mineur

- Catégorie : rendu ; classe : deterministe
- Description : Pas de balise meta viewport.
- Preuve attendue : html : absence de `<meta name="viewport">`.
- Correction type : Ajouter `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- Source officielle : aucune dans le dossier de référence

## structure

### GEO-TITLE-ABSENT

**Gravité** : bloquant

- Catégorie : structure ; classe : deterministe
- Description : Page sans balise title.
- Preuve attendue : html : absence de `<title>` non vide.
- Correction type : Ajouter un title unique et descriptif à chaque page.
- Source officielle : aucune dans le dossier de référence

### GEO-TITLE-DOUBLON

**Gravité** : important

- Catégorie : structure ; classe : deterministe
- Description : Plusieurs pages partagent le même title.
- Preuve attendue : html : même title sur plusieurs pages.
- Correction type : Donner à chaque page un title propre à son contenu.
- Source officielle : aucune dans le dossier de référence

### GEO-DESC-ABSENT

**Gravité** : mineur

- Catégorie : structure ; classe : deterministe
- Description : Page sans meta description.
- Preuve attendue : html : absence de `<meta name="description">`.
- Correction type : Rédiger une description propre à chaque page.
- Source officielle : aucune dans le dossier de référence

### GEO-H1-ABSENT

**Gravité** : important

- Catégorie : structure ; classe : deterministe
- Description : Page sans titre de niveau 1.
- Preuve attendue : html : aucun titre de niveau 1.
- Correction type : Ajouter un h1 qui nomme le sujet de la page.
- Source officielle : aucune dans le dossier de référence

### GEO-HN-SAUT

**Gravité** : mineur

- Catégorie : structure ; classe : deterministe
- Description : Saut de niveau dans la hiérarchie des titres (par exemple h2 puis h4).
- Preuve attendue : html : séquence de titres avec un saut de niveau (h2 puis h4).
- Correction type : Respecter la hiérarchie des titres sans sauter de niveau.
- Source officielle : aucune dans le dossier de référence

### GEO-ALT-ABSENT

**Gravité** : mineur

- Catégorie : structure ; classe : deterministe
- Description : Images sans attribut alt (alt="" est valide pour une image décorative).
- Preuve attendue : html : `<img>` sans attribut `alt` (`alt=""` reste valide pour une image décorative).
- Correction type : Décrire les images porteuses de sens dans `alt` ; laisser `alt=""` pour les images décoratives.
- Source officielle : aucune dans le dossier de référence

### GEO-LANG-ABSENT

**Gravité** : important

- Catégorie : structure ; classe : deterministe
- Description : Pas d’attribut lang sur l’élément html.
- Preuve attendue : html : absence d’attribut `lang` sur `<html>`.
- Correction type : Ajouter `<html lang="fr">` (ou la langue de la page).
- Source officielle : aucune dans le dossier de référence

## international

### GEO-HREFLANG-RECIPROQUE

**Gravité** : important

- Catégorie : international ; classe : deterministe
- Description : Un hreflang désigne une page explorée qui ne renvoie pas vers la première.
- Preuve attendue : html : une page déclare un hreflang vers une page explorée qui ne renvoie pas vers elle.
- Correction type : Faire déclarer à chaque version l’ensemble des versions, elle-même comprise.
- Source officielle : aucune dans le dossier de référence

### GEO-HREFLANG-XDEFAULT

**Gravité** : mineur

- Catégorie : international ; classe : deterministe
- Description : Des hreflang sont déclarés sans entrée x-default.
- Preuve attendue : html : hreflang sans entrée `x-default`.
- Correction type : Ajouter une entrée `x-default` vers la version de repli.
- Source officielle : aucune dans le dossier de référence

## donnees-structurees

### GEO-JSONLD-INVALIDE

**Gravité** : important

- Catégorie : donnees-structurees ; classe : deterministe
- Description : Bloc JSON-LD illisible (JSON invalide).
- Preuve attendue : jsonld : erreur d’analyse JSON d’un bloc `application/ld+json`.
- Correction type : Corriger la syntaxe JSON (virgules, guillemets) et valider le bloc.
- Source officielle : aucune dans le dossier de référence

### GEO-JSONLD-AVIS-NON-VISIBLES

**Gravité** : important

- Catégorie : donnees-structurees ; classe : heuristique
- Description : AggregateRating dont la note n’apparaît pas dans le texte visible de la page (arrondie à une décimale).
- Preuve attendue : jsonld : `ratingValue` d’un `AggregateRating` absent du texte visible (comparaison arrondie à une décimale, virgule ou point).
- Correction type : Afficher la note sur la page ou retirer le balisage : les données structurées doivent correspondre au contenu visible.
- Source officielle : https://developers.google.com/search/docs/appearance/ai-features

## contenu

### GEO-DATE-ABSENTE

**Gravité** : mineur

- Catégorie : contenu ; classe : heuristique
- Description : Aucune date de publication ni de modification sur une page d’article ou de documentation.
- Preuve attendue : html : ni `datePublished` / `dateModified`, ni meta de date, ni `<time datetime>` sur une page d’article ou de documentation (heuristique : type Article ou chemin /blog/, /docs/, etc.).
- Correction type : Afficher et baliser la date de publication et de mise à jour.
- Source officielle : aucune dans le dossier de référence

### GEO-CONTENU-AUCUNE-DEFINITION

**Gravité** : mineur

- Catégorie : contenu ; classe : heuristique
- Description : Aucun passage de la page ne s’ouvre sur une définition : motif « X est un / une / des » (français) ou « X is a / an / the », « X are » (anglais) dans les deux premières phrases du passage, ou bloc de définition. Calculé seulement pour le français et l’anglais ; un sujet pronominal (« Il est un… », « C’est un… », « It is a… ») ne compte pas. Les blocs `nosnippet` sont exclus.
- Preuve attendue : html : nombre de passages analysés, aucun ne présentant le motif.
- Correction type : Si la page porte sur un sujet à définir, ouvrir la section concernée par une phrase de définition autonome ; sinon ignorer.
- Source officielle : aucune dans le dossier de référence

### GEO-CONTENU-SANS-SOURCE

**Gravité** : mineur

- Catégorie : contenu ; classe : heuristique
- Description : Aucun passage ne cite de source : ni formule (« selon », « d’après », « source : », « according to »…), ni lien externe. Limite : les faits extraits ne rattachent pas les liens aux blocs ; un lien est rattaché à un passage quand son texte (3 caractères au moins) apparaît tel quel dans un bloc du passage et que son hôte diffère de celui de la page.
- Preuve attendue : html : nombre de passages analysés, aucun ne citant de source.
- Correction type : Attribuer les chiffres et affirmations vérifiables à leur source, avec un lien vers elle quand elle est en ligne.
- Source officielle : aucune dans le dossier de référence

### GEO-CONTENU-AUTEUR-ABSENT

**Gravité** : mineur

- Catégorie : contenu ; classe : heuristique
- Description : Aucun auteur déclaré (meta author, lien rel="author" ou JSON-LD) sur une page d’article ou de documentation (même règle de page que GEO-DATE-ABSENTE : JSON-LD Article / BlogPosting, ou chemin de type `/blog/…`, `/docs/…`, `/guide/…`) dont au moins un passage a été analysé. Les pages d’accueil, de contact ou de tarifs ne sont pas concernées.
- Preuve attendue : html : absence de meta author, de lien rel="author" et d’auteur JSON-LD.
- Correction type : Afficher et baliser l’auteur réel quand la page est signée ; ne pas en inventer.
- Source officielle : aucune dans le dossier de référence

### GEO-CONTENU-PASSAGES-DEPENDANTS

**Gravité** : mineur

- Catégorie : contenu ; classe : heuristique
- Description : Plus de 50 % des passages commencent par un pronom ou un connecteur de la liste de la langue (« Il », « Cela », « It », « However »…), donc se comprennent mal isolés du texte précédent.
- Preuve attendue : html : nombre de passages non autonomes sur le total.
- Correction type : Reformuler la première phrase des sections concernées pour nommer le sujet au lieu de le reprendre par un pronom.
- Source officielle : aucune dans le dossier de référence

## entite

Ces constats sont produits par `outils/lib/entites.mjs`. Les valeurs relevées viennent uniquement des pages : l’outil n’en invente aucune. Les vérifications manuelles (registre légal du pays, profils) sont décrites dans `references/entites.md`.

### GEO-ENTITE-SANS-ORGANIZATION

**Gravité** : important

- Catégorie : entite ; classe : deterministe
- Description : Aucun JSON-LD d’organisation (Organization, LocalBusiness, Corporation ou sous-type) sur les pages explorées.
- Preuve attendue : jsonld : aucun nœud de type organisation sur les pages explorées (relire les blocs `application/ld+json`).
- Correction type : Déclarer une organisation en JSON-LD (type adapté à l’activité, voir `references/entites.md`) avec des valeurs réellement présentes sur le site. Google indique qu’aucun balisage spécial n’est requis pour les fonctions d’IA : les données structurées doivent correspondre au contenu visible.
- Source officielle : https://developers.google.com/search/docs/appearance/ai-features

### GEO-ENTITE-NOM-INCOHERENT

**Gravité** : important

- Catégorie : entite ; classe : deterministe
- Description : Le nom de l’entité s’écrit de plusieurs façons (og:site_name, JSON-LD, suffixe du title), même après normalisation (minuscules, sans accents, sans forme juridique ni ponctuation).
- Preuve attendue : html : liste des champs et des URL où chaque variante apparaît (`og:site_name`, `name` JSON-LD, suffixe du title après le dernier `|`, `–`, `—` ou ` - `).
- Correction type : Choisir une seule graphie du nom et l’employer partout ; si plusieurs noms sont légitimes (nom commercial et raison sociale), le dire explicitement sur le site.
- Source officielle : aucune dans le dossier de référence

### GEO-ENTITE-COORDONNEES-CONTRADICTOIRES

**Gravité** : important

- Catégorie : entite ; classe : deterministe
- Description : Deux téléphones ou deux adresses différents dans les JSON-LD d’organisation du site (téléphones comparés sur les chiffres, adresses sur rue et code postal).
- Preuve attendue : jsonld : valeurs différentes et pages où elles figurent.
- Correction type : Aligner les coordonnées de tous les JSON-LD sur celles affichées sur le site ; pour un site à plusieurs établissements, décrire chacun comme un établissement distinct.
- Source officielle : aucune dans le dossier de référence

### GEO-ENTITE-SAMEAS-ABSENT

**Gravité** : mineur

- Catégorie : entite ; classe : deterministe
- Description : Une organisation est déclarée en JSON-LD sans aucun sameAs vers ses profils officiels.
- Preuve attendue : jsonld : propriété `sameAs` absente de tous les nœuds d’organisation.
- Correction type : Ajouter dans `sameAs` les URL des profils officiels qui existent réellement ; ne rien ajouter si aucun profil n’existe.
- Source officielle : aucune dans le dossier de référence

### GEO-ENTITE-PRODUIT-SANS-SCHEMA

**Gravité** : mineur

- Catégorie : entite ; classe : heuristique
- Description : Page dont le h1 reprend (comparaison exacte après normalisation) le nom d’un produit ou service balisé sur une autre page, sans balisage Product, SoftwareApplication ou Service sur elle-même.
- Preuve attendue : html : h1 de la page et page où le produit est balisé. Heuristique : aucune correspondance approximative.
- Correction type : Si la page décrit bien ce produit ou service, y ajouter le balisage correspondant avec des valeurs visibles sur la page ; sinon ignorer.
- Source officielle : aucune dans le dossier de référence

### GEO-ENTITE-ENTITES-TIERCES

**Gravité** : information

- Catégorie : entite ; classe : deterministe
- Description : Nœuds JSON-LD d’organisation reconnus comme des entités tierces listées par le site (fiches de professionnels, établissements d’un annuaire ou d’une place de marché) : ils ne sont pas comparés à l’identité du site. Un nœud est tiers quand il n’est pas une organisation d’ancrage (page d’accueil ou de départ sans `url` ailleurs, ou `url` / `@id` sur la racine, `/index.*` compris, paramètres ignorés), que son nom est distinct de tous les noms du site (`og:site_name`, `WebSite.name`, `--marque`, organisations d’ancrage) et qu’il porte une `url` (ou un `@id`) propre hors racine, ou, sur un annuaire (au moins deux fiches hors accueil, sous des noms différents, dont le nom est repris par le `h1`), un nom repris par le `h1` de sa page. Ils n’alimentent ni `GEO-ENTITE-NOM-INCOHERENT`, ni `GEO-ENTITE-COORDONNEES-CONTRADICTOIRES`, ni `GEO-ENTITE-SAMEAS-ABSENT`, ni `GEO-ENTITE-SANS-ORGANIZATION` ; leur nombre (noms distincts) est donné dans `entite.entites_tierces`. Règle détaillée : `references/entites.md`.
- Preuve attendue : jsonld : pages portant ces nœuds, nombre d’entités et trois noms au plus en extrait.
- Correction type : Aucune : ce constat indique seulement que l’outil a reconnu des entités listées. Si l’une d’elles est en réalité l’entité du site, lui donner le nom du site ou une `url` sur la racine.
- Source officielle : aucune dans le dossier de référence

### GEO-ENTITE-WIKIDATA-AMBIGU

**Gravité** : information

- Catégorie : entite ; classe : deterministe
- Description : Plusieurs entrées Wikidata portent le même libellé que l’entité, et aucune (ou plusieurs) ne déclare l’hôte audité comme site officiel (propriété P856). Vérification optionnelle (`--wikidata`), seulement si `www.wikidata.org` est un hôte autorisé ; sinon le statut reste `non_verifie`. Statuts possibles : `non_verifie`, `absent`, `libelle_identique` (une entrée de même libellé dont le site officiel n'est pas l'hôte audité : « libellé identique trouvé, identité non vérifiée », non crédité), `ambigu`, `trouve` (une entrée dont le site officiel P856 est sur l'hôte audité, seul cas crédité).
- Preuve attendue : http : requête `wbsearchentities` (`preuve.commande` : `curl -s '<url>'`), identifiants Q retournés, puis requête `wbgetentities&props=claims` pour lire le site officiel P856 de chaque candidat.
- Correction type : Aucune action automatique : le propriétaire vérifie quelle entrée le désigne, si elle existe (vérification manuelle).
- Source officielle : aucune dans le dossier de référence
