# Rapport avant / après — `validation-produit` v1 → v2 (2026-11-24)

**Banc** : application de démonstration locale (outil de sécurité, données fictives), **même commit** du produit pour les deux versions de la skill, construit et prouvé (révision, version affichée, page embarquée). Parcours : « je viens d'installer l'outil, mon projet est-il en danger, que faire en premier ? ». Défauts semés par le proxy : **F** (un élément disparaît des listes, les compteurs restent justes), **U** (bouton principal renommé en jargon), **S** (faux succès : enregistrement annoncé, rien en base).

> Toutes les réussites et ressentis ci-dessous sont **déclarés par des personas simulés**. Ce n'est pas une étude auprès d'utilisateurs humains.

## Chiffres

| | v1 | v2 | Témoin sans skill |
|---|---|---|---|
| Exécutions (propre + semé) | 6 (3 personas × 1) | 16 (4 personas × 2 essais) | 4 (1 × 2) |
| Exécutions exploitables | 6/6 | 16/16 | **1/4** (3 abandons au premier refus d'outil) |
| Citations retrouvées dans ce que l'outil a montré | 0,94 (mesuré après coup) | **0,98** propre / **0,97** semé | 1,00 (7 citations, 1 exécution) |
| Lignes de pas (intention, compréhension, hésitation prédite) | 0 | 63 | 0 |
| Défauts semés détectés (par défaut, validateur ou persona) | 3/3 | **3/3** | 3/3 (une seule exécution utile) |
| Persona par défaut (arbitre) | non mesuré | F 4/4, U 2/4 (débutant, senior), S 3/4 | — |
| Fausses alertes du passage propre | 0 | 1 alerte du validateur (persona qui a mal cliqué), **non confirmée** par l'arbitre (`à_rejouer`) ; 4 fausses alertes de personas **écartées** par l'arbitre | — |
| Anomalies consolidées, id stables | à la main | 33 propre (32 observées) / 24 semé ; 11 fusions par l'arbitre | — |
| Contre-expertise indépendante | à la main | 5 rejouées : 1 reproduite, 1 non reproduite (écartée), 3 indécidables | — |
| Clavier seul + zoom 200 % | impossible | 4 exécutions, **0 clic**, 60 à 67 touches | — |
| Déclenchement de la skill (20 requêtes) | rappel 0,8, 0 faux | **rappel 1,0, 0 faux** | — |
| Auto-test des scripts | aucun | 29/29 | — |
| Coût (équivalent API) | 1,58 $ (2,4 M tokens) | 4,93 $ passages + 0,39 expert + 0,52 arbitres + ~0,7 rejeux ≈ **6,5 $** ; ~0,31 $ par exécution | 0,27 $ |

## Ce que la v2 apporte de vérifiable

1. **Fiche appliquée** : écran, zoom, clavier seul et patience imposés par le banc ; le persona au clavier n'a jamais pu cliquer.
2. **Moins d'hallucinations admises** : chaque citation est vérifiée ; les anomalies sans preuve restent des hypothèses.
3. **Rôles séparés** : l'expert a fourni un chemin de référence et 10 règles métier sourcées (fichier:ligne) sans jamais voir les personas ; l'arbitre a écarté 4 fausses alertes et refusé de confirmer l'alerte non prouvée.
4. **Comparaison entre profils** (passage propre, déclaré) :

| Vérification | débutant | développeur | experte | clavier + zoom |
|---|---|---|---|---|
| comprend à quoi sert le produit | oui ×2 | oui ×2 | oui ×2 | oui ×2 |
| comprend les termes | partiel ×2 | partiel / oui | oui ×2 | partiel ×2 |
| interprète boutons et messages | partiel ×2 | partiel ×2 | partiel ×2 | oui ×2 |
| accomplit l'objectif | partiel ×2 | oui / partiel | oui ×2 | oui ×2 |

Obstacles communs (3 profils ou plus) : jargon et texte en anglais sur l'écran de correction, chiffres contradictoires entre écrans, priorité contredite par un compteur. Spécifiques : focus clavier (persona clavier ; **reproduit** par le rejoueur), date et confirmation (expert).

5. **Mesuré ≠ estimé** : durée technique 61-178 s par exécution ; temps humain estimé par le modèle KLM 38-123 s ; estimation des personas 5-20 min. Les trois sont présentés séparément et étiquetés.

## Ce qui reste faible (honnêtement)

- **Sur-compétence** : tous les personas disent « trouve sans aide » et presque aucun ne revient en arrière (0 à 2 retours) ; la recherche le prévoit (`references/limites.md`). Les lignes de pas font prédire les hésitations, mais pas plus.
- **Rejeu peu déterministe** : 3 rejeux sur 5 indécidables (étapes ancrées sur une citation, pas sur l'instant précis du constat). Prochaine étape : générer un script Playwright depuis les actions réelles (P2).
- **Accessibilité déterministe (axe) et émulation réseau/CPU** : non faites (P2).
- **Variance** : 2 essais par persona seulement ; les verdicts du validateur sur le passage semé varient (F trouvé par le validateur dans 5 exécutions sur 8, S dans 6 sur 8) parce qu'un persona qui n'atteint pas l'écran ne peut rien affirmer.
- **Coût** : la v2 approfondie coûte environ 4 fois la v1 standard ; le mode `standard` v2 (3 personas × 1, arbitre) reste autour de 1 à 2 $.

## Critères d'acceptation

| # | Critère | Résultat |
|---|---|---|
| A1 | Auto-test 100 % | ✔ 29/29 |
| A2 | Déclenchement rappel ≥ 0,9, 0 faux | ✔ 1,0 / 0 (1 essai par requête) |
| A3 | Validateur 3/3 défauts semés | ✔ (par défaut ; par exécution F 5/8, S 6/8) |
| A4 | Personas ≥ 2/3 défauts | ✔ 3/3 |
| A5 | 0 fausse alerte confirmée sur le propre | ✔ 0 confirmée ; 1 alerte restée « à rejouer » (rejeu indécidable) |
| A6 | Citations ≥ 0,95 | ✔ 0,97-0,98 |
| A7 | Fiche appliquée | ✔ clavier 0 clic ; zoom ; patience (essai de fumée) |
| A8 | Aucun secret ni chemin personnel | ✔ après correction (chemins absolus trouvés puis retirés du manifeste) |
| A9 | Reprise | ✔ |
| A10 | Anomalie observée = preuve vérifiée + étapes | ◐ preuve 100 % ; étapes 55/56 |
| A11 | Standard ≤ 2 $ pour 3 personas | ✔ ~0,9 $ (0,31 $ par exécution) |
| A12 | Mieux que le témoin | ✔ 16/16 exploitables contre 1/4 |
