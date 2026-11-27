# Identité de l’entité : repères

Ce fichier accompagne l’analyse `outils/lib/entites.mjs`. Il décrit ce que l’outil relève, ce qu’il ne fait pas, et ce qui reste à vérifier à la main.

## Principe

Décrire l’entité (nom, activité, coordonnées, profils) de façon identique partout sur le site. Les données structurées ne servent qu’à dire ce que la page montre déjà : elles doivent correspondre au contenu visible. Google indique qu’aucun balisage spécial n’est nécessaire pour apparaître dans ses fonctions d’IA (benchmark, sections 2.5 et 2.6). Aucune garantie de citation par les assistants ne découle d’un schéma : ces constats visent la cohérence et la lisibilité, pas un effet promis.

## Règle : aucune valeur inventée

Ne jamais renseigner une valeur absente du site : pas de numéro de téléphone, d’adresse, de numéro d’immatriculation, d’horaires, de note ou de profil `sameAs` qui ne figurent pas déjà sur le site ou sur le profil officiel réel. Si l’information n’existe pas, le champ reste absent. L’outil ne propose jamais de valeur : il relève, compare et signale.

## Types schema.org recommandés par nature d’activité

| Activité | Type principal | Remarque |
|---|---|---|
| Entreprise ou association sans lieu d’accueil | `Organization` (ou `Corporation`, `NGO`) | Nom, URL, logo, `sameAs` |
| Commerce, artisan, cabinet avec adresse | `LocalBusiness` ou un sous-type précis (`Store`, `Restaurant`, `Electrician`, `LegalService`...) | Adresse postale, téléphone, horaires affichés |
| Professionnel de santé | `Physician`, `Dentist` ou `MedicalBusiness` | Seulement les informations publiées sur le site |
| Boutique en ligne | `OnlineStore` | Produits décrits en `Product` sur leurs pages |
| Éditeur de logiciel | `Organization` + `SoftwareApplication` pour chaque application | |
| Prestation de service | `Organization` ou `LocalBusiness` + `Service` pour chaque prestation | |
| Média, blog | `Organization` (ou `NewsMediaOrganization`) + `WebSite` | |

Le `WebSite.name` et le `name` de l’organisation doivent employer la même graphie que `og:site_name` et que le titre des pages.

## Entité du site et entités tierces (annuaires, places de marché)

Un annuaire, une place de marché ou un réseau décrit souvent, sur chaque fiche, une autre entité que lui-même (un praticien en `Physician`, un commerce en `LocalBusiness`…), avec ses propres nom, téléphone et adresse. Ces nœuds ne sont pas l’identité du site : les comparer à elle produirait de fausses incohérences. L’outil sépare donc, parmi les nœuds JSON-LD d’organisation de premier niveau :

1. **Les noms du site** : `og:site_name`, `WebSite.name`, l’option `--marque`, et le nom des **organisations d’ancrage**. Le suffixe du `title` n’en fait pas partie (il ne fait que corroborer).
2. **Les organisations d’ancrage**, toujours rattachées au site : un nœud dont l’`url` (ou l’`@id`) désigne la racine du site (même hôte, `www.` ignoré, chemin `/`, sans paramètre), ou un nœud de la page d’accueil (ou de départ) qui ne porte pas d’`url` ailleurs. Les valeurs réduites à un fragment (`#organisation`) ou à un nœud anonyme (`_:b0`) sont ignorées.
3. **Les entités tierces** : un nœud qui n’est pas d’ancrage, dont **chaque** nom est distinct de **tous** les noms du site (même règle d’inclusion en mots entiers que pour la cohérence du nom), et qui porte **soit** une `url` (ou un `@id`) propre hors racine (chemin de fiche, autre hôte), **soit**, hors page d’accueil, un nom repris par le `h1` de sa page. Sans aucun nom du site connu, ou pour un nœud sans nom, rien n’est écarté.
4. **Tout le reste** est l’entité du site, comme avant.

Les entités tierces n’alimentent ni la cohérence du nom (`GEO-ENTITE-NOM-INCOHERENT`), ni celle des coordonnées (`GEO-ENTITE-COORDONNEES-CONTRADICTOIRES`), ni `GEO-ENTITE-SAMEAS-ABSENT`, ni `GEO-ENTITE-SANS-ORGANIZATION` (un site qui ne déclare que des entités tierces n’a pas d’organisation à lui), ni les types relevés. Leur nombre (noms distincts) est donné dans `entite.entites_tierces`, et le constat d’information `GEO-ENTITE-ENTITES-TIERCES` cite leurs pages, pour que l’utilisateur voie qu’elles ont été reconnues. Un site réellement incohérent reste signalé : deux nœuds du site (accueil, racine, ou nom du site ou variante) aux noms ou téléphones différents, ou un nœud sans `url` ni `h1` correspondant qui porte un autre nom.

## Ce que l’outil contrôle

- Présence d’un JSON-LD d’organisation, nom cohérent entre `og:site_name`, JSON-LD et suffixe du `title`.
- Coordonnées (téléphones, adresses) identiques dans tous les JSON-LD d’organisation du site ; les autres nœuds (`Person`, etc.) et les entités tierces sont ignorés.
- Présence de `sameAs` (URL `http` ou `https` seulement).
- Heuristique étroite : une page dont le `h1` est exactement le nom d’un produit balisé ailleurs.
- Option : recherche du nom sur Wikidata (`wbsearchentities`, puis `wbgetentities&props=claims` sur les candidats de même libellé, réponses JSON), seulement avec `--wikidata` et si `www.wikidata.org` est un hôte autorisé ; sinon statut `non_verifie` avec la raison. Une entrée n'est reconnue (`trouve`, seul cas crédité dans le score) que si son **site officiel (P856)** est sur l'hôte audité ; un libellé identique seul donne `libelle_identique` (« libellé identique trouvé, identité non vérifiée »), plusieurs candidats `ambigu`, aucun `absent`. En mode dossier, aucun hôte n'est audité : au mieux `libelle_identique`.

## Vérifications manuelles (non automatisées)

Ces points ne sont pas contrôlés par l’outil et ne doivent pas être présentés comme vérifiés :

- Le registre légal du pays de l’entité (registre du commerce, répertoire des entreprises, ordre professionnel) : la dénomination et l’adresse du site doivent concorder avec l’inscription officielle.
- Les profils réellement détenus (fiche d’établissement, réseaux sociaux, annuaires professionnels) : leur existence, leur propriétaire et la cohérence du nom, de l’adresse et du téléphone avec le site.
- Le choix de la bonne entrée Wikidata en cas d’homonymes, ou l’absence d’entrée.
- Le fait que les coordonnées déclarées soient celles que le propriétaire souhaite rendre publiques.
