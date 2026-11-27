---
description: GEO / AEO audit of a website for AI answer engines (robots, technical access, entity, citable content, potential scores, report).
argument-hint: "<audit|quick|deep|technical|content|report|cost|…> [url]"
---

Sous-commande et arguments : `$ARGUMENTS`.

Charger le skill `geo` (outil Skill) et suivre ses règles (accord réseau de session, niveau d'autonomie, aucun chiffre sans preuve), puis router :

- `audit [url]` (ou rien) : déroulé complet du skill `geo` ;
- `quick [url]` : même déroulé avec `--max-pages 10` ; `deep [url]` : avec `--max-pages 200` ;
- `technical [url]` : skill `geo-technique` ; `content [url]` : skill `geo-contenu` ;
- `report [id]` : `geo.mjs rapport --audit <id> --format md` (dernier audit de la session si l'id manque ; le demander s'il n'y en a pas) ;
- `cost` : répondre que le mode gratuit (audit, scénarios, rapports) ne coûte rien et qu'aucun appel payant n'existe en 0.1 ;
- `visibility`, `citations`, `competitors` : répondre « prévu en 0.2 » ;
- `why-not`, `fix`, `verify`, `compare`, `history`, `monitor`, `logs`, `benchmark` : répondre « prévu en 0.3 ».

Pour une sous-commande prévue : dire ce qui est disponible maintenant (`audit`, `quick`, `deep`, `technical`, `content`, `report`, `cost`, et la préparation des scénarios avec le skill `geo-scenarios`), **ne rien simuler et n'inventer aucun résultat**. Sous-commande inconnue : lister les sous-commandes disponibles.
