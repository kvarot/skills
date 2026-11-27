# Données personnelles et confidentialité (version 0.1.0)

## Ce qui reste sur votre machine

Le plugin n'a **pas de serveur**, pas de compte, pas de télémétrie. Il écrit dans un seul dossier : `.claude/geo/` du dossier courant (ou `GEO_HOME` s'il est défini). Contenu :

| Fichier | Contenu |
|---|---|
| `session.json` | hôtes que vous avez autorisés pour la session |
| `geo.sqlite` | audits (constats, scores, extraits bornés) et jeux de scénarios figés |
| `tmp/` | passages complets des pages, écrits par `auditer` pour le lecteur de contenu, puis exportés par lots ; vidés par `exporter-contenu --purger` |
| `profil.json` | profil confirmé, écrit par la session à votre demande |

Rien n'est écrit ailleurs.

**Cache.** Les réponses HTTP sont gardées **en mémoire, le temps d'une commande** : chaque audit relit le site, et la version 0.1 n'écrit aucune réponse sur disque. La bibliothèque réseau sait tenir un cache disque (`cache/`) dont les fichiers ne sont expirés **qu'à la lecture** (jamais supprimés d'eux-mêmes) ; la CLI ne s'en sert pas. Si un dossier `cache/` existe dans le dossier de données, il peut être supprimé à la main sans conséquence.

**Passages.** `auditer` écrit le texte des passages dans `tmp/audit-<id>/passages.json` (il ne peut pas être reconstitué plus tard depuis la base). Chaque parcours des skills (`geo`, `geo-technique`, `geo-contenu`, `geo-entites`) se termine par `exporter-contenu --purger`, même en cas d'échec ou d'arrêt ; si une session s'interrompt avant, lancez la purge vous-même.

## Ce qui sort de votre machine

- **Rien n'est envoyé sans votre accord explicite**, hôte par hôte, pour la session ; l'accord est effacé au début de la session suivante.
- L'audit **lit** les hôtes que vous avez autorisés : le site audité, et `www.wikidata.org` seulement si vous demandez la vérification Wikidata (le nom de la marque y est alors envoyé comme terme de recherche). Les requêtes portent un agent utilisateur `geo-audit/0.1`, sans identifiant personnel.
- Le contenu lu par le modèle de votre session (extraits, avis du lecteur de contenu, rapport) est traité par le service du modèle que vous utilisez avec Claude Code, selon ses propres conditions. Auditez un site dont vous avez le droit d'analyser le contenu.
- La version 0.1 n'appelle aucune API d'assistant et n'envoie aucune donnée à un tiers.

## Purge et suppression

- `node outils/geo.mjs exporter-contenu --purger` vide `tmp/` (passages écrits par l'audit et lots exportés). Les skills la lancent en fin de parcours.
- `cache/`, s'il existe, se supprime à la main (voir « Cache »).
- Pour tout effacer : supprimer le dossier `.claude/geo/` (ou `GEO_HOME`). Aucune autre trace n'existe.
- Ne versionnez pas ce dossier : il peut contenir le texte de pages et vos profils de marque ; ajoutez `.claude/geo/` à votre `.gitignore`.

## Données de tiers

Un site audité peut contenir des noms et coordonnées de personnes (page de contact, mentions légales). Ils peuvent apparaître dans `geo.sqlite` (extraits bornés) et, jusqu'à la purge, dans `tmp/`. Vous en êtes responsable comme de tout traitement de ces données ; supprimez le dossier quand l'audit est terminé.
