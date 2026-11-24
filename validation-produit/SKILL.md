---
name: validation-produit
description: Use when a web product must be tried the way real people of different profiles would use it - beginners and experts, different jobs, keyboard-only, zoomed or small screens - to learn whether they understand it, find their way, reach their goal without help and can trust the result. Simulated users are technically isolated from the source code; an independent validator checks that "done" is really done; seeded defects prove detection; one consolidated, evidence-backed report compares profiles and versions. Triggers - "fais tester le produit par des personas", "campagne de validation", "est-ce qu'un débutant s'en sort ?", "au clavier seul, ça passe ?", "compare comment X et Y comprennent cet écran", "valide ce parcours avant la release". Not for unit/e2e test writing, code review, visual redesign or interviewing real users.
---

# Validation produit par utilisateurs simulés

Une équipe de test courte, en trois familles d'agents qui ne partagent pas leur contexte :

| Famille | Qui | Voit | Ne voit jamais |
|---|---|---|---|
| **Utilisateurs** | personas (`modeles/personas/`), lancés par `outils/lancer-persona.mjs` | l'écran du produit, leur fiche, l'objectif | code, docs internes, autres agents |
| **Experts** | `agents/expert-produit.md` | code, docs, specs du produit | les consignes des personas |
| **Arbitres** | validateur (script de l'adaptateur), `outils/consolider.mjs`, `agents/arbitre.md`, rejoueur (`modeles/personas/rejoueur.md`) | les preuves de la campagne, la vérité lue dans le produit | — |

Tout ce qui est propre à un produit tient dans un `adaptateur.json` (voir `references/adaptateur.md`).

## Règles qui ne plient pas

1. **Une simulation n'est pas un utilisateur.** Réussite, temps, hésitations, frustration des personas sont **déclarés ou estimés**, étiquetés ainsi partout ; jamais présentés comme une étude humaine (`references/limites.md`).
2. **Isolation imposée, pas demandée.** Un persona = un `claude -p` à part : aucun outil intégré, un seul serveur navigateur limité à l'origine du produit (`--allowedUrlPattern`), `file://` et JavaScript côté serveur coupés, hook `outils/garde-url.py` qui refuse le reste et **refuse sur toute erreur**, dossier vide, aucun réglage ni CLAUDE.md chargé.
3. **La fiche est appliquée, pas jouée.** Taille d'écran, zoom, clavier seul (outils de clic retirés) et budget de patience (le hook arrête le persona) viennent de la fiche (`references/persona-schema.md`). Le parcours et la fiche ne donnent aucun libellé d'écran ni nom interne : le lanceur refuse sinon.
4. **Instance jetable, données fictives, commit prouvé.** Jamais la vraie instance ni de vraies données. Le produit est construit depuis un commit nommé, interface comprise, avec preuve ; sinon la campagne refuse. Le commit testé est en tête du rapport.
5. **Preuve ou hypothèse.** Chaque citation d'un persona est vérifiée contre ce que le navigateur lui a réellement renvoyé (`outils/analyser-journal.mjs`) ; une anomalie sans citation retrouvée ni verdict du validateur reste une **hypothèse**. Les étiquettes exécuté / constaté / vérifié / reproduit / déclaré / estimé / bloqué sont définies dans `references/anomalie-schema.md`.
6. **Contre-expertise.** Toute anomalie bloquante, ou de confiance basse, est rejouée par un rejoueur indépendant. Tout « faux » du validateur sur le passage propre est rejoué avant d'être compté. Personne ne valide sa propre correction.
7. **Rien de privé, rien ne sort.** Jetons, chemins personnels, nom d'utilisateur masqués dans les journaux. Les exports GitHub/Notion sont des brouillons locaux ; les publier demande l'accord explicite du propriétaire.
8. **Tout ce qui est lancé est arrêté et supprimé** (instance, proxy, navigateur, dossiers temporaires).

## Déroulé

1. **Cadrer** : adaptateur, parcours (objectif d'utilisateur, pas une liste de clics), mode selon la criticité du changement.
2. **Lancer** : `node outils/campagne.mjs --adaptateur a.json --sortie <dossier> --mode <mode>`. La campagne s'enregistre dans `campagne.json` et **reprend** là où elle s'est arrêtée si on la relance.
3. Pour chaque exécution : instance neuve → proxy (défauts semés ou non) → persona isolé → `analyse.json` (mesures, citations, lignes de pas) → validateur.
4. **Consolider** (sans IA) : `anomalies.json` (identifiants stables, doublons fusionnés, étapes de reproduction réelles, fréquence, gravité, confiance), `synthese.json` (mesures et 8 vérifications comportementales côte à côte, obstacles communs / spécifiques), `rapport-auto.md`, brouillons d'export.
5. **Expert** (mode approfondi) : chemin de référence, règles métier et attendus sourcés (`expert.json`).
6. **Arbitre** : fusion des doublons restants, décision par anomalie, défauts semés détectés ou manqués, fausses alertes (`arbitrage.json`).
7. **Contre-expertise** : rejeu indépendant de ce que l'arbitre marque `à_rejouer`.
8. **Rapport** humain avec `modeles/rapport.md` ; **comparaison** entre versions avec `outils/comparer.mjs`.

## Modes (adapter le coût au risque)

| Mode | Personas × essais | Passages | Agents en plus | Ordre de grandeur mesuré (2026-11) |
|---|---|---|---|---|
| `rapide` | 1 × 1 | propre | — | ~0,2 $ d'équivalent API, 1-2 min |
| `standard` | 3 × 1 | propre + semé | arbitre | ~1,6 $, ~6 min |
| `approfondi` | 4 × 2 | propre + semé | expert, arbitre, contre-expertise | ~6,5 $, ~25 min |
| `pre-release` | toutes × 2, tous les parcours | propre + semé | expert, arbitre, contre-expertise | à mesurer |

Bornes : `--paralleles` (3 par défaut), `--budget-usd` par persona, `--budget-total-usd` par campagne (les exécutions restantes sont sautées), `--minutes` par persona, budget d'interactions par la patience de la fiche. Ne lance pas tous les agents par défaut : `rapide` pour un petit changement d'écran, `standard` pour un parcours, `approfondi` avant une bêta, `pre-release` avant une version.

## Évaluer la skill

`references/evaluation.md` : déclenchement (`evals/eval-declenchement.mjs`), corpus à défauts semés, groupe témoin sans skill (`evals/temoin.md`), comparaison ancienne / nouvelle version.

## Prérequis

Node 20+, Python 3, Claude Code CLI, Chrome 149+ (pour `--allowedUrlPattern`), `chrome-devtools-mcp` **figé** (1.14.0 testé). Windows : pas de bac à sable Claude Code ; pour aller plus loin, conteneur WSL sans dépôt ni réseau sortant.

## Idées empruntées (aucun code repris)

PabloManzoni/user-simulation (MIT) : juge qui ne voit que l'écran, citations mot pour mot. gotalab/uxaudit (Apache-2.0) : « non vérifiable » ≠ « échec ». lovelaced/ux-test : liste blanche fixée au lancement, persona privé d'outils. anthropics/skills skill-creator (Apache-2.0) : évaluation du déclenchement, témoin sans skill. obra/superpowers (MIT) : vérifier avant d'affirmer, contrôle sans consigne. vercel-labs/agent-browser (Apache-2.0) : profils d'émulation imposés par l'orchestrateur. Conduction test-counsel (EUPL-1.2) : persona experte en accessibilité. *Synthetic Cognitive Walkthrough* (2025) : faire prédire l'hésitation à chaque pas.
