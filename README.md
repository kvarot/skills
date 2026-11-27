# Skills

Bibliothèque de skills pour Claude Code (et autres agents qui lisent le même format), construite au fil des projets.

| Skill | À quoi elle sert |
|---|---|
| [`ai-delivery-manager`](ai-delivery-manager/SKILL.md) | Donner des délais fondés sur des durées mesurées : temps actif réel des agents lu dans les journaux de session et l'historique Git, estimation à trois points calibrée sur les tâches finies, écart prévu / réel. Outil Node sans dépendance, tests inclus (`node --test ai-delivery-manager/evals/adm.test.mjs`). |
| [`chef-de-projet-ia`](chef-de-projet-ia/SKILL.md) | Piloter un projet logiciel avec plusieurs sessions d'IA, machines et un runner de tests : registre de tâches à états prouvés, réservations de zones, portes de fusion, relectures indépendantes, passations, arrêt d'urgence. Le registre refuse lui-même un état sauté, une preuve sans forme ou prise sur un ancien commit, et une validation par l'auteur du travail ; tests inclus (`node --test chef-de-projet-ia/evals/taches.test.mjs`). |
| [`ia-locale`](plugins/ia-locale/skills/ia-locale/SKILL.md) | Faire faire le développement par une IA locale (llama.cpp ou Ollama + agent OpenCode) avant toute IA payante, escalade mesurée vers Claude ou Codex, et commande `/ia-usage` : usage local, tokens et argent économisés (prix officiels datés, jamais devinés). |
| [`validation-produit`](validation-produit/SKILL.md) | Faire tester un produit web par des utilisateurs simulés **isolés du code** (débutant, développeur, expert), avec un validateur qui vérifie l'état réel, des défauts semés pour prouver la détection et un rapport consolidé. |

## Plugins

| Plugin | À quoi il sert |
|---|---|
| [`seo`](plugins/seo/README.md) | Audit SEO d'un site web et corrections écrites dans le code du projet, lot par lot après validation du développeur : outils Node déterministes, six skills et un agent d'audit. Sous licence MIT. |

Installation : `/plugin marketplace add kvarot/skills` puis `/plugin install seo@kvarot-skills`.

## Installer une skill

Copier son dossier dans `~/.claude/skills/<nom>/` (skills personnelles) ou `.claude/skills/<nom>/` d'un projet. Chaque skill est autonome ; ce qui est propre à un projet va dans une fiche d'adaptation gardée hors de ce dépôt.

## Règles de ce dépôt

- Rien de personnel ni de sensible : aucun nom de projet privé, chemin de machine, adresse, jeton, nom de serveur.
- Pas de code repris d'autres projets sans licence qui le permette ; les idées empruntées sont citées dans la skill concernée.
- Licence : tous droits réservés (voir [`LICENSE`](LICENSE)). Lecture libre ; toute réutilisation demande un accord écrit. Exception : `plugins/seo/` est sous licence MIT (voir [`plugins/seo/LICENSE`](plugins/seo/LICENSE)).
