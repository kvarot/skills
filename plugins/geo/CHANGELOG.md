# Journal des modifications

Format : une section par version.

## 0.1.0

Première version.

### Ajouté

- Plugin `geo` : point d'entrée unique (skill `geo`) et quatre skills ciblés (`geo-technique`, `geo-contenu`, `geo-entites`, `geo-scenarios`), un agent de lecture seule (`lecteur-contenu`).
- CLI `outils/geo.mjs`, sans dépendance, Node ≥ 22.5 : `init`, `autoriser`, `auditer`, `robots`, `scenarios generer|figer|lister`, `scores`, `rapport`, `exporter-contenu`.
- Couche réseau gardée : liste d'hôtes autorisés par session, refus des adresses internes à chaque redirection, bornes de taille, de délai et de débit.
- Audit technique, registre des robots IA par rôle (RFC 9309), détection de défi CDN / WAF, entités et données structurées, citabilité du contenu en français et en anglais.
- Six scores de potentiel avec couverture et critères non calculés ; quatre scores de mesure à `null` ; plateformes « non mesuré ».
- Scénarios déterministes à graine, jeux figés et empreintés.
- Base SQLite, rapports Markdown et JSON, registre des fausses idées.
- Sites de référence fictifs, tests, évaluation de déclenchement ; documentation complète en français.

### Décisions

- Pas de dossier `commands/` : le skill `geo` est le seul point d'entrée.
- Aucun appel facturable : mode gratuit complet.

### Limites connues

Voir « Limites » dans le [README](README.md).
