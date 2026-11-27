# Scénarios de recherche

Les scénarios sont les requêtes qu'une personne réelle poserait à un moteur ou à un assistant IA. Ils servent à mesurer la **découverte naturelle** d'un site : on regarde si le site est cité quand personne ne le nomme. Ils sont produits par `outils/lib/scenarios.mjs` (fonction `genererScenarios`), de façon reproductible : même profil, même niveau, même graine, même jeu.

## 1. Profil du site à confirmer avec l'utilisateur

Avant toute génération, construire le profil à partir du site analysé (page d'accueil, pages offres, mentions légales), puis le **faire confirmer ou corriger par l'utilisateur**. Un profil faux produit des scénarios hors sujet, donc une mesure sans valeur.

| Champ | Contenu attendu | Exemple fictif |
|---|---|---|
| `categorie` | Noms de catégorie, sans article, tels qu'on les chercherait | `logiciel de planification` |
| `besoins` | Ce que veut faire la personne (FR : verbe à l'infinitif ; EN : forme en *-ing*) | `planifier les interventions` |
| `zones` | Villes ou secteurs servis, sans préposition | `Lyon`, `Nantes` |
| `concurrents` | Concurrents réels du marché, connus de l'utilisateur | `Planorama` |
| `contraintes` | Exigences réglementaires ou techniques, groupe nominal | `conformité RGPD` |
| `marque` | `{ nom, alias: [] }` : nom du site et ses variantes (sigle, domaine) | `{ nom: "Lumivia", alias: ["Lumivia Pro"] }` |
| `langue` | `fr` ou `en` | `fr` |

Les listes vides sont acceptées : le générateur retire alors ce qui ne peut pas être produit et le dit dans `manques` (pas de `zones` : intention `local` retirée ; pas de `concurrents` : gabarits `{concurrent}` écartés). Mieux vaut demander la donnée manquante à l'utilisateur que livrer un jeu réduit.

## 2. Niveaux et tailles

| Niveau | Scénarios |
|---|---|
| `rapide` | 25 |
| `standard` | 100 |
| `approfondi` | 500 |
| `exhaustif` | 1000 |

Les effectifs par intention sont proportionnels aux poids de `donnees/intentions.json`, arrondis au plus fort reste. Au sein d'une intention, les profils d'internaute (`donnees/profils.json`) sont tirés selon leur poids, avec un générateur pseudo-aléatoire à graine (`mulberry32`) : jamais de `Math.random`.

Quand les combinaisons distinctes manquent, le jeu est **plus petit** que la taille demandée et `manques` l'explique. Le générateur ne remplit jamais par répétition. Les quasi-doublons (formes normalisées identiques ou similarité de Jaccard sur les mots supérieure ou égale à 0,8) sont écartés ; le premier est conservé. Deux requêtes qui ne diffèrent que par la tournure du profil (« je débute, … ») comptent comme un doublon.

Chaque scénario porte `profil`, `intention`, `poids` (sa part du total, la somme vaut 1) et `avec_marque`.

## 3. Règle « pas de marque »

Une requête de découverte ne nomme **jamais** la marque du site ni ses alias : sinon on mesurerait la reconnaissance du nom, pas la découverte. Le générateur vérifie chaque texte rempli (mot entier, sans tenir compte de la casse ni des accents) et écarte les fautifs, y compris quand la donnée du profil contient la marque. Seuls les concurrents peuvent apparaître, et seulement dans les intentions `alternative` et `comparaison` (champ `avec_marque_autorise` : il autorise un concurrent nommé, jamais la marque).

## 4. Requêtes de marque

Des requêtes nommant la marque (« avis sur Lumivia ») restent utiles pour vérifier ce que les assistants savent du site, mais elles mesurent autre chose. Elles sont ajoutées à part, marquées par `marquerMarque(scenarios, marque)` (`avec_marque: true`) et **exclues des chiffres d'en-tête** de visibilité naturelle. Elles se présentent toujours séparément.

## 5. Enrichissement facultatif par le modèle

Le modèle peut proposer des catégories, besoins, zones ou formulations supplémentaires. Ces ajouts ne sont jamais ajoutés tels quels au jeu : ils sont **ajoutés au profil** puis le jeu est régénéré par `genererScenarios`, qui applique le dédoublonnage, la règle « pas de marque » et le calcul de l'empreinte. Un texte venu d'ailleurs qui n'est pas passé par là ne doit pas entrer dans un jeu figé. Tout texte importé doit être passé par `marquerMarque`.

## 6. Jeu figé avant toute mesure

L'`empreinte` (SHA-256 des textes normalisés et triés) identifie le jeu. Dès que l'utilisateur valide le jeu :

1. l'enregistrer avec `figerJeu(base, origine, resultat, { langue, pays })` ;
2. ne plus le modifier : toute modification (ajout, retrait, reformulation) donne un **nouveau jeu** avec une nouvelle empreinte ;
3. toute mesure cite l'empreinte du jeu utilisé, pour que deux mesures ne soient comparées que si elles portent sur le même jeu.

Modifier le jeu après avoir vu des résultats reviendrait à choisir les questions qui arrangent : la règle protège contre ce biais.
