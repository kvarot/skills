# Architecture cible, plan et critères d'acceptation (v2)

## Architecture : une skill, trois familles d'agents, des scripts déterministes

Choix : **ne pas multiplier les skills**. Une seule skill `validation-produit` ; les rôles sont des agents (fichiers de prompt) et des scripts. La séparation du contexte est **technique** (processus distincts, outils distincts), pas une consigne.

```
adaptateur.json (privé, par produit)
        │
campagne.mjs ── manifeste campagne.json (reprise, budget, statuts)
   │
   ├─ pour chaque exécution (parallèle borné) :
   │    instance neuve ─ proxy (propre | semé) ─ lancer-persona.mjs ─ claude -p isolé
   │         (fiche → écran, zoom, clavier seul, patience imposés ; garde fail-closed)
   │    → journal.jsonl, resultat.md, captures
   │    → analyser-journal.mjs : mesures, citations vérifiées, lignes de pas  (sans IA)
   │    → validateur de l'adaptateur : vérité lue dans le produit             (sans IA)
   │
   ├─ consolider.mjs : anomalies.json (id stable, doublons, étapes réelles), synthese.json   (sans IA)
   ├─ agent expert   : lit le code/docs → expert.json (attendus sourcés)      [Read, Grep, Glob]
   ├─ agent arbitre  : lit les preuves seulement → arbitrage.json              [Read]
   ├─ rejoueur       : persona vérificateur isolé, rejoue les étapes           [navigateur seul]
   └─ comparer.mjs   : version A vs B (nouvelles / persistantes / disparues)    (sans IA)
```

| Choix | Pourquoi | Alternative écartée |
|---|---|---|
| Un `claude -p` par persona | seul moyen vérifié d'avoir un contexte vide et des outils fixés au lancement | sous-agents dans la session : l'orchestrateur peut leur souffler ce qu'il sait |
| Scripts pour mesurer, vérifier, consolider | reproductible, gratuit, pas d'hallucination | correcteur IA (skill-creator) : coûteux, non déterministe |
| IA seulement pour jouer, attendre et juger | là où il faut du jugement | IA partout |
| chrome-devtools-mcp figé | `--allowedUrlPattern`, `file://` et JS coupables, déjà en place | Playwright MCP : pas de frontière réseau équivalente ; agent-browser : à évaluer (P2) |

## Plan incrémental (fait dans cet ordre, chaque étape testée)

| # | Étape | Test | État |
|---|---|---|---|
| 1 | Fiche persona structurée + application (écran, zoom, clavier, patience) | `persona.mjs` sur chaque fiche ; exécution réelle clavier seul : 0 clic, limite de patience atteinte et respectée | fait |
| 2 | Règles v2 : ligne de pas, hésitation prédite, aide, abandon justifié, 8 vérifications, format générique (`specifique`) | exécution réelle : lignes de pas et demande d'aide lues | fait |
| 3 | Anti-fuite (`interdits`) | refus constaté au lancement (faux positif corrigé : seule la partie objectif est contrôlée) | fait |
| 4 | Analyse déterministe (mesures, citations, KLM étiqueté) | 12 journaux v1 réanalysés ; auto-test (citation inventée détectée) | fait |
| 5 | Consolidation (anomalies, id stables, étapes, fréquence, synthèse, exports) | v1 réconsolidée ; auto-test | fait |
| 6 | Lanceur de campagne générique (modes, reprise, budgets, ports) | reprise constatée après échec ; campagne complète | fait |
| 7 | Agents expert, arbitre, rejoueur | campagne approfondie | fait |
| 8 | Comparaison de versions | auto-test + v1 vs v2 | fait |
| 9 | Évals : déclenchement, témoin sans skill, tests des scripts | 20 requêtes ; 4 exécutions témoin ; 29 contrôles hors ligne | fait |
| 10 | Accessibilité déterministe (axe dans le validateur), émulation réseau/CPU imposée, spec Playwright générée depuis le rejeu | — | P2, non fait |

## Critères d'acceptation mesurables

| # | Critère | Seuil |
|---|---|---|
| A1 | Auto-test hors ligne des scripts | 100 % vert |
| A2 | Déclenchement de la skill (20 requêtes) | rappel ≥ 0,9, 0 faux déclenchement |
| A3 | Défauts semés détectés par le validateur | 3/3 |
| A4 | Défauts semés vus par au moins un persona | ≥ 2/3 |
| A5 | Fausses alertes confirmées sur le passage propre | 0 |
| A6 | Citations des personas retrouvées dans ce que l'outil a montré | ≥ 0,95 en moyenne |
| A7 | Fiche appliquée : clavier seul ⇒ 0 clic ; zoom ⇒ fenêtre réduite ; patience ⇒ arrêt | 100 % des exécutions |
| A8 | Aucun jeton, chemin personnel ou nom d'utilisateur dans les sorties | 0 occurrence |
| A9 | Reprise : relancer une campagne ne refait que ce qui n'est pas fait | vérifié |
| A10 | Chaque anomalie `observé` porte au moins une preuve vérifiée et des étapes de reproduction | 100 % |
| A11 | Coût du mode standard | ≤ 2 $ d'équivalent API par passage de 3 personas |
| A12 | Mieux que le témoin sans skill | plus de défauts semés vus, plus de citations vérifiées, moins d'exécutions inutilisables |
