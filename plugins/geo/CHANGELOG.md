# Journal des modifications

Format : une section par version.

## 0.1.0

Première version.

### Ajouté

- Plugin `geo` : point d'entrée unique (skill `geo`) et quatre skills ciblés (`geo-technique`, `geo-contenu`, `geo-entites`, `geo-scenarios`), un agent de lecture seule (`lecteur-contenu`).
- CLI `outils/geo.mjs`, sans dépendance, Node ≥ 22.13 (vérifié au lancement) : `init`, `autoriser`, `auditer`, `robots`, `scenarios generer|figer|lister`, `scores`, `rapport`, `exporter-contenu`.
- Couche réseau gardée : liste d'hôtes autorisés par session, refus des adresses internes à chaque redirection, bornes de taille, de délai et de débit.
- Audit technique, registre des robots IA par rôle (RFC 9309), détection de défi CDN / WAF, entités et données structurées, citabilité du contenu en français et en anglais.
- Six scores de potentiel avec couverture et critères non calculés ; quatre scores de mesure à `null` ; plateformes « non mesuré ».
- Scénarios déterministes à graine, jeux figés et empreintés.
- Base SQLite, rapports Markdown et JSON, registre des fausses idées.
- Sites de référence fictifs, tests, évaluation de déclenchement ; documentation complète en français.

### Corrigé avant publication (revue finale)

- Un audit sans page (robots.txt interdit tout ou inaccessible) ne crédite plus l'identité numérique ; cohérence du nom et des coordonnées non calculées sans nom ou organisation déclarés.
- `robots.txt` en 5xx ou sans réponse : constat bloquant `GEO-ROBOTSTXT-INACCESSIBLE` ; sitemaps non lus = pas de `GEO-SITEMAP-ABSENT` ; `/llms.txt` en échec = « non vérifié ».
- `--wikidata` : requêtes en `Accept: application/json` ; identité reconnue seulement par le site officiel (P856) sur l'hôte audité, statut `libelle_identique` sinon.
- Cache limité à une commande (chaque audit relit le site), `exploration.depuis_cache` ; `auditer` utilise le dernier jeu de scénarios figé de l'origine.
- Commandes rejouables dans `preuve.commande` (non échappées, URL encodées) ; mode dossier : `--max-pages` respecté, fichier nommé au lieu d'une commande.
- Redirection de la page de départ vers un hôte non autorisé : code 3 nommant l'hôte. Plages IPv6 refusées complétées (NAT64 local, site-local, Teredo, IPv4 traduite).
- `GEO-CONTENU-AUTEUR-ABSENT` seulement sur les pages d'article ou de documentation.

### Décisions

- Pas de dossier `commands/` : le skill `geo` est le seul point d'entrée.
- Aucun appel facturable : mode gratuit complet.

### Limites connues

Voir « Limites » dans le [README](README.md).
