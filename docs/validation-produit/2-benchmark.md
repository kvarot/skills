# Benchmark (lu le 2026-11-24, lecture seule : code, instructions et scripts, pas seulement les README)

Rien n'a été installé ni exécuté. « Vérifié » = mécanisme lu dans le code ou les instructions ; « promesse » = seulement annoncé.

## Solutions étudiées

| Solution | Licence | Activité | Ce qui existe vraiment | Isolation de l'utilisateur simulé |
|---|---|---|---|---|
| anthropics/skills — skill-creator | Apache-2.0 (par skill) | 2026-04 | évals `evals.json`, correcteur `grading.json` avec vérification des affirmations, agrégation avec/sans skill (moyenne ± écart-type), comparaison à l'aveugle, éval du déclenchement par `claude -p` (vérifié ; `select()` sur pipe, incompatible Windows) | sans objet |
| anthropics/skills — webapp-testing | Apache-2.0 | 2026-04 | `with_server.py` (démarre/arrête des serveurs), « reconnaître puis agir » | aucune |
| anthropics/skills — frontend-design | Apache-2.0 | 2026-09 | prose : marques d'un design généré par IA, règles de rédaction des boutons | sans objet |
| Conduction test-counsel (pipelinq) | EUPL-1.2 | 2026-11 | 8 personas en parallèle (prose), modes Quick/Full, scénarios Gherkin ; fiches personas citées mais absentes du dépôt public (promesse) | aucune : les personas lisent les specs, login admin |
| altock/ux-webapp | MIT annoncée, pas de fichier LICENSE | 2025-12, arrêté | prose : schéma d'anomalie (sévérité, confiance, principe, Given/When/Then) | sans objet |
| microsoft/playwright-mcp | Apache-2.0 | très actif | serveur MCP navigateur ; `--allowed-origins` « not a security boundary » ; `browser_run_code_unsafe` actif par défaut | outil |
| ChromeDevTools/chrome-devtools-mcp | Apache-2.0 | très actif (1.14.0) | `--allowedUrlPattern`, `--fileNavigations=false`, `--javascriptEvaluation=false`, catégories désactivables, `emulate` (réseau, CPU, mobile), `lighthouse_audit` ; télémétrie active par défaut | outil |
| dequelabs/axe-core | MPL-2.0 | actif (4.14.1) | règles WCAG par étiquettes ; `incomplete` = revue manuelle, pas un succès | outil |
| obra/superpowers | MIT | actif (7.0.2) | tests de skills : témoin sans consigne, scénarios de pression, 5 répétitions, harness `claude -p` avec assertions ; « pas d'affirmation sans preuve fraîche » | sans objet |
| vercel-labs/agent-browser | Apache-2.0 | très actif (0.44.0) | CLI navigateur, références d'éléments compactes, `--allowed-domains`, émulation d'appareil, audit axe intégré, marqueurs anti-injection | outil |
| PabloManzoni/user-simulation | MIT | 2026-10 | juge en personnage qui ne voit que l'arbre d'accessibilité | partielle (Read) |
| lovelaced/ux-test | aucune licence | abandonné | liste blanche d'outils fixée par le SDK | **vraie**, mais code inutilisable |
| gotalab/uxaudit | Apache-2.0 | 2026-10, expérimental | capture puis jugement, « non vérifiable » ≠ « échec », ~40 contrôles | partielle |
| UXAgent (recherche) | MIT | faible | personas tirés selon des poids, questionnaire après parcours | — |
| Playwright Test Agents | Apache-2.0 | actif | planificateur → générateur → réparateur de tests | — |
| Explorbot | Elastic-2.0 | actif | recherche → plan → exécution → vérification → conservation en specs | — |

## Matrice des capacités

Légende : ✔ vérifié en exécution · ◐ partiel · ✘ absent · (p) promesse documentaire chez le concurrent.

| Capacité | Nous v1 | Meilleur concurrent | Nous faisons mieux | Moins bien / absent v1 | Amélioration v2 | Coût | Prio |
|---|---|---|---|---|---|---|---|
| Isolation technique du persona | ✔ processus séparé + hook fail-closed + origine verrouillée | ux-test (liste blanche SDK) | seuls à prouver l'isolation par sonde et à couper `file://` et le réseau | — | fiche → outils retirés (clavier seul) | faible | P0 ✔ |
| Fiche persona structurée et **appliquée** | ✘ prose | Conduction (focus mesurable, prose) | — | aucun champ appliqué | schéma 17 champs, écran / zoom / clavier / patience imposés | moyen | P0 ✔ |
| Contre la sur-compétence | ✘ | Synthetic Cognitive Walkthrough (recherche) | — | rien | ligne de pas « où ta personne hésiterait », pas d'erreur fabriquée | faible | P0 ✔ |
| Anti-fuite du parcours | ✘ | aucun | — | — | liste `interdits`, refus au lancement | faible | P0 ✔ |
| Vérification des citations (anti-hallucination) | ✘ | skill-creator (affirmations vérifiées par un correcteur IA) | v2 : vérification **déterministe** contre ce que l'outil a montré | — | `analyser-journal.mjs` | faible | P0 ✔ |
| Mesures comportementales | ◐ appels d'outils | Conduction (compter les clics, promesse) | v2 : mesuré dans le journal | retours, aide, superflu, temps humain | `analyse.json` + KLM étiqueté | faible | P0 ✔ |
| Schéma d'anomalie, id stable, dédoublonnage, fréquence | ✘ | ux-webapp (prose), Conduction (« vu par 3+ ») | v2 : outillé, reproductible | — | `consolider.mjs` | moyen | P0 ✔ |
| Étapes de reproduction | ✘ | ux-webapp (Given/When/Then, prose) | v2 : tirées des actions réelles | — | `consolider.mjs` | faible | P0 ✔ |
| Validateur de vérité | ✔ | aucun | unique | — | lit `specifique` | — | ✔ |
| Défauts semés pour prouver la détection | ✔ | aucun | unique | — | test du proxy | — | ✔ |
| Agents expert / arbitre séparés | ✘ | skill-creator (correcteur ≠ comparateur ≠ analyste) | — | — | `agents/expert-produit.md`, `agents/arbitre.md` | moyen | P1 ✔ |
| Contre-expertise indépendante | ◐ manuelle | aucun | — | — | rejoueur automatique | moyen | P1 ✔ |
| Orchestration : modes, parallèle, budget, reprise | ◐ | Conduction Quick/Full (sans budget chiffré) | v2 : budget total, reprise par manifeste | — | `campagne.mjs` | moyen | P1 ✔ |
| Historique et comparaison de versions | ✘ | skill-creator (`history.json`, itérations) | — | — | `comparer.mjs` | faible | P1 ✔ |
| Exports GitHub / Notion | ✘ | aucun | — | — | brouillons locaux, jamais envoyés | faible | P1 ✔ |
| Auto-évaluation de la skill | ✘ | skill-creator, superpowers | v2 : déclenchement + témoin + corpus + tests des scripts | — | `evals/` | moyen | P1 ✔ |
| Accessibilité déterministe (axe) | ✘ (promesse v1) | agent-browser (axe intégré), uxaudit | — | absent | injecter axe dans le validateur ; défauts a11y semés | moyen | P2 |
| Émulation réseau lent / CPU / tactile | ✘ | chrome-devtools-mcp `emulate`, agent-browser `set device` | — | absent | appel `emulate` imposé par l'orchestrateur avant le persona | moyen | P2 |
| Génération de tests de non-régression | ✘ | Playwright Test Agents, Explorbot | — | absent | rejeu des étapes (rejoueur) déjà là ; spec Playwright à générer | moyen | P2 |
| Instantanés réduits (tokens) | ✘ | agent-browser (`-i`, `--max-output`) | — | — | instantanés filtrés côté orchestrateur | moyen | P2 |
| Tests desktop, mobile natif, CLI, API par personas | ✘ | aucun avec isolation | — | — | hors périmètre ; API/CLI par l'expert et le validateur | élevé | P3 |
| Comparaison concurrentielle | ✘ | aucun | — | — | parcours identique sur un produit concurrent jetable (licence à vérifier) | élevé | P3 |

## Redondant ou inutile

pa11y (LGPL, redondant avec axe) ; un deuxième serveur navigateur (Playwright MCP) ; les plugins qui pilotent le vrai Chrome connecté de l'utilisateur (risque de données réelles) ; les personas qui lisent le code (contraire au but).
