# Skills

Bibliothèque de skills pour Claude Code (et autres agents qui lisent le même format), construite au fil des projets.

| Skill | À quoi elle sert |
|---|---|
| [`chef-de-projet-ia`](chef-de-projet-ia/SKILL.md) | Piloter un projet logiciel avec plusieurs sessions d'IA, machines et un runner de tests : registre de tâches à états prouvés, réservations de zones, portes de fusion, relectures indépendantes, passations, arrêt d'urgence. |
| [`validation-produit`](validation-produit/SKILL.md) | Faire tester un produit web par des utilisateurs simulés **isolés du code** (débutant, développeur, expert), avec un validateur qui vérifie l'état réel, des défauts semés pour prouver la détection et un rapport consolidé. |

## Installer une skill

Copier son dossier dans `~/.claude/skills/<nom>/` (skills personnelles) ou `.claude/skills/<nom>/` d'un projet. Chaque skill est autonome ; ce qui est propre à un projet va dans une fiche d'adaptation gardée hors de ce dépôt.

## Règles de ce dépôt

- Rien de personnel ni de sensible : aucun nom de projet privé, chemin de machine, adresse, jeton, nom de serveur.
- Pas de code repris d'autres projets sans licence qui le permette ; les idées empruntées sont citées dans la skill concernée.
- Licence : aucune pour l'instant, tous droits réservés.
