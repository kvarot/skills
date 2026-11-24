# Audit de `validation-produit` v1 (commit 538714a, 2026-11-24)

Lu : les 10 fichiers du dossier (439 lignes) et les sorties de deux campagnes réelles v1 sur une application de démonstration (6 exécutions chacune). Pas de skill dépendante ; une seule skill, mais une partie générique (le lanceur de passages) vivait dans l'adaptateur privé du produit.

## Ce qui était réellement implémenté (vérifié par exécution)

| Capacité | Fichier | Preuve |
|---|---|---|
| Persona isolé dans un `claude -p` à part (aucun outil intégré, navigateur seul) | `outils/lancer-persona.mjs` | sondes : lecture de fichier impossible ; 12 exécutions réelles |
| Garde fail-closed (outils, origine, chemins) | `outils/garde-url.py` | sonde : `file://` refusé, canari jamais lu |
| Réseau du navigateur limité à l'origine du produit | `--allowedUrlPattern` | clics externes bloqués par Chrome |
| Défauts semés sans toucher au produit (masquer, remplacer, faux succès) | `outils/proxy-defauts.mjs` | 3/3 détectés par le validateur |
| Masquage jetons, chemins, nom d'utilisateur | lanceur | aucun secret retrouvé dans 12 journaux |
| Validateur indépendant (vérité lue dans le produit) | adaptateur (privé) | a attrapé le faux succès, et une affirmation fausse d'un persona |
| Mesures techniques (appels d'outils, tokens, durée, coût) | lanceur | `mesures.json` |

## Ce qui était annoncé mais pas outillé (promesses documentaires)

- « Audit déterministe Lighthouse / axe » : aucun script.
- Modes « ciblé », « régression (rejouer sans IA) », « release » : pas de lanceur, pas de rejeu.
- « Relecture indépendante », « consolider » : faites à la main.
- « 30 actions au plus » : consigne dans le prompt, jamais appliquée.

## Défauts, contradictions, ambiguïtés

1. **Contradiction générique / spécifique** : le format de réponse « générique » du persona contenait des champs d'un produit précis (`failles_vues`, `decision_enregistree`).
2. **Personas en prose de 8 lignes** : ni métier structuré, ni environnement, ni besoins d'accessibilité, ni stratégie, ni seuil d'abandon, ni critères de satisfaction. Rien de la fiche n'était **appliqué** (fenêtre fixe 1280×900, tous les outils pour tous).
3. **Comportement non mesuré** : pas de retours arrière, revisites, demandes d'aide, étapes superflues ; temps humain absent ou mêlé au temps technique.
4. **Hallucination non contrôlée** : les citations des personas n'étaient pas vérifiées ; une affirmation de succès fausse n'a été attrapée que par le validateur, et un persona a cité une « erreur console » sans avoir d'outil console.
5. **Pas de schéma d'anomalie** ni d'identifiant stable, pas de déduplication, pas de fréquence : consolidation à la main, non reproductible.
6. **Pas d'agent expert ni d'arbitre** : les rôles « connaît le code » et « juge » étaient tenus par l'orchestrateur lui-même (biais de confirmation).
7. **Pas de reprise** d'une campagne interrompue, pas de budget global.
8. **Anti-fuite partiel** : rien n'empêchait un parcours de dicter les libellés de l'interface au persona.
9. **Pas d'auto-évaluation** : ni test du déclenchement, ni témoin sans skill, ni tests des scripts.

## Risques de résultats non vérifiables

Taux de réussite et frustration déclarés par des modèles (sur-compétence documentée, voir `references/limites.md`) ; constats d'interface sur une page périmée (corrigé en v1.1 par la construction depuis un commit) ; « faux succès » du validateur dû à une erreur de clic du persona (corrigé par la règle de rejeu).

## Conformité Agent Skills

Front matter `name` + `description` correct, `SKILL.md` court. Manquaient : divulgation progressive (pas de `references/`), description sans cas de non-déclenchement, scripts non auto-testés. Compatibilité Codex : la skill se lit telle quelle (même format), mais les personas exigent le CLI Claude Code (`claude -p`).
