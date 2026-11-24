# Limites des utilisateurs simulés (à rappeler dans chaque rapport)

Ce que dit la recherche 2025-2026 (lue le 2026-11-24 ; résumés, pas reproduits ici) :

- **Trop compétents** : des modèles qui jouent des utilisateurs réussissent plus de tâches, par des chemins plus directs, et repèrent moins de points d'échec que des humains, sauf si on leur demande explicitement où un novice échouerait. — *Synthetic Cognitive Walkthrough*, 2025, arXiv 2512.03568.
- **Trop coopératifs** : comparés à 451 vrais participants, 31 simulateurs sont plus agréables, moins variés, rarement frustrés ou ambigus. — *Mind the Sim2Real Gap in User Simulation for Agentic Tasks*, 2026, arXiv 2603.11245.
- **Mal calibrés** : taux de réussite variant jusqu'à 9 points selon le modèle qui joue l'utilisateur ; sous-estimés sur les tâches dures, surestimés sur les moyennes. — *Lost in Simulation*, 2026, arXiv 2601.17087.
- **Peu fidèles au niveau de l'action** : environ 12 % de « prochaine action » humaine prédite correctement en ligne de commerce. — *Can LLM Agents Simulate Multi-Turn Human Behavior?*, 2026, arXiv 2503.20749.
- **Les personas ne règlent pas ça** : les fiches rendent les réponses plus crédibles, pas plus justes. — *What Would GPT Click*, 2026, arXiv 2605.18302.

## Ce que le banc en tire

1. Les personas servent à **trouver des défauts** (parcours cassés, libellés obscurs, impasses, faux succès), pas à mesurer l'utilisabilité.
2. Chaque pas demande « où ta personne hésiterait ici » (contre la sur-compétence) ; une erreur n'est jamais fabriquée sans cause visible.
3. Plusieurs essais par persona : on regarde ce qui revient (stabilité), pas un succès isolé.
4. Taux de réussite, temps, frustration : **déclarés ou estimés**, jamais présentés comme une étude humaine. Ils ne remplacent pas des essais avec de vraies personnes.
5. Ce qui n'est pas émulé (toucher, réseau lent, vrai lecteur d'écran) est dit dans le rapport.
