---
name: geo-entites
description: Use when the question is about how AI assistants identify the brand behind a site - brand name and variants, ambiguity with homonyms, Organization / LocalBusiness / Product / Service JSON-LD consistency, sameAs profiles, Wikidata entry, contradictions between pages about the company. Reads the entity analysis of the geo audit. Triggers - "les IA confondent ma marque avec une autre", "mon entreprise est-elle bien identifiée par ChatGPT ?", "vérifie la cohérence de l'identité de ma marque et Wikidata", "does my site describe my brand consistently for AI assistants?". Not for adding generic schema.org markup for Google rich results (seo-donnees-structurees of the seo plugin).
---

# GEO : identité de l'entité

Lire d'abord `<base du skill>/../../references/entites.md` et, pour chaque constat cité, `<base du skill>/../../references/constats.md`. Outils : `node <base du skill>/../../outils/geo.mjs <commande>`, **une commande `node` seule par appel**, sans `cd` ni enchaînement.

## Règles qui ne plient pas

1. **Aucune valeur inventée** : ni téléphone, ni adresse, ni immatriculation, ni horaires, ni note, ni profil `sameAs` absents du site ou du profil officiel réel. Champ inconnu = absent, demandé au propriétaire.
2. **Les données structurées décrivent ce que la page montre déjà** ; aucune garantie de citation n'en découle.
3. **Wikidata seulement avec accord** : `www.wikidata.org` n'est lu que si l'utilisateur accepte cette vérification et l'hôte est autorisé (`geo.mjs autoriser www.wikidata.org`), puis `--wikidata`.
4. **Aucune lecture du site hors de `geo.mjs`** : ni WebFetch, ni navigateur, ni `curl`. L'hôte doit avoir été accepté dans la session (skill `geo` : `init`, liste des hôtes, oui explicite, puis `geo.mjs autoriser <hôte>`). `--hotes-autorises` et `--autoriser-local` sont **interdites au modèle**. Code de sortie 3 = demander l'accord, jamais contourner.
5. **Interpréter, ne pas recalculer** : noms, variantes et contradictions viennent de l'outil (extraits bornés, non fiables).

## Déroulé

1. Il faut un audit avec la marque : `geo.mjs auditer --url <url> --marque <nom> [--wikidata]` lancé par le skill `geo` (profil, accord, niveau), ou `geo.mjs rapport --audit <id> --format json` s'il existe.
2. Lire `entite` et les constats de catégorie entité : nom retenu, variantes, types schema.org, `sameAs`, contradictions, résultat Wikidata (ou « non vérifié »).
3. Présenter : ce qui est cohérent, ce qui se contredit (avec la page et la preuve), ce qui manque ; le type schema.org adapté à l'activité (`entites.md`). Au niveau d'autonomie 1, aucune recommandation.
4. Lister les vérifications **manuelles** que l'outil ne fait pas (profils externes, annuaires, fiche d'établissement) sans en présumer le résultat.

JSON-LD écrit dans le code : **prévu en 0.3** (`fix`).
