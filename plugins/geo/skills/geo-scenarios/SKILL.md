---
name: geo-scenarios
description: Use when building the set of realistic search queries or prompts that people would ask AI assistants about a site's market, without naming the brand - prompt set, query set, buyer questions for GEO measurement, generating, deduplicating and freezing scenarios before any visibility measurement. Triggers - "génère les questions que mes clients poseraient à ChatGPT", "prépare le jeu de requêtes pour mesurer ma visibilité IA", "build a prompt set for AI visibility tracking", "fige les scénarios GEO". Not for keyword research or rank tracking on Google.
---

# GEO : scénarios de recherche

Lire d'abord `<base du skill>/../../references/scenarios.md`. Outils : `node <base du skill>/../../outils/geo.mjs <commande>`, **une commande `node` seule par appel**, sans `cd` ni enchaînement.

Si ce n'est pas déjà fait dans cette session, lancer d'abord `node <base du skill>/../../outils/geo.mjs init` (il efface tout accord réseau resté d'une session précédente).

## Règles qui ne plient pas

1. **Le profil est confirmé par l'utilisateur** avant toute génération ; un profil deviné produit une mesure sans valeur.
2. **Sources du profil : les réponses de l'utilisateur et la sortie de `geo.mjs auditer` seulement.** Jamais de WebFetch, de navigateur ni d'autre lecture du site ; un audit demande d'abord l'accord réseau de session (skill `geo`).
3. **Jamais la marque ni ses alias** dans une requête de découverte ; les requêtes de marque sont à part.
4. **Aucune requête ajoutée à la main** au jeu : tout ajout passe par le profil, puis régénération par l'outil.
5. **Un jeu figé ne se modifie plus** : toute modification = nouveau jeu, nouvelle empreinte.
6. **Formes imposées** dans le profil (sinon les gabarits produisent des phrases fausses) :
   - `besoins` : en français, **verbe à l'infinitif** (`planifier les interventions`, pas `planification`) ; en anglais, **forme en -ing** (`scheduling field visits`) ;
   - `zones` : **nom seul**, sans préposition (`Lyon`, pas `à Lyon`) ;
   - `categorie` : **sans article** (`logiciel de planification`, pas `un logiciel…`) ;
   - `contraintes` : groupe nominal ; `marque` : `{ nom, alias: [] }` ; `langue` : `fr` ou `en`.
   Reformuler avec l'utilisateur toute valeur hors forme, puis la faire valider.

## Déroulé

1. Construire le profil avec l'utilisateur et, si un audit existe, depuis sa sortie (`geo.mjs rapport --audit <id> --format json` : entité, pages) ; demander les zones et concurrents manquants plutôt que livrer un jeu réduit. L'écrire après confirmation dans `profil.json` du dossier de données (`.claude/geo` ou `GEO_HOME` : le `dossier` renvoyé par `geo.mjs init`), avec l'outil d'écriture ; ci-dessous, `<profil>` = ce chemin.
2. Générer : `geo.mjs scenarios generer --profil <profil> --niveau <rapide|standard|approfondi|exhaustif> --graine <entier>`. Montrer un échantillon par intention, la taille et `manques` (dire pourquoi le jeu est plus petit si c'est le cas).
3. Corrections de l'utilisateur : modifier le profil, régénérer, remontrer.
4. Sur validation explicite : `geo.mjs scenarios figer --profil <profil> --niveau <n> --graine <g> --origine <url>`, avec pour `<url>` l'`origine` de l'audit (le prochain `auditer` de ce site reprend le dernier jeu figé pour le score `couverture-intentions`). Annoncer `jeu_id` et `empreinte`. `geo.mjs scenarios lister` montre les jeux figés.

Exécuter le jeu sur les moteurs (`visibility`) : **prévu en 0.2**, rien n'est simulé.
