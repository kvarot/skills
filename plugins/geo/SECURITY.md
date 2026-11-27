# Sécurité (version 0.1.0)

Le plugin lit des sites web, donc du texte qu'il ne contrôle pas. Ce document décrit les protections réellement en place, leurs limites, et comment signaler un problème.

## Garde réseau (SSRF)

Toute lecture passe par `outils/lib/reseau.mjs` :

- schémas `http` et `https` seulement ;
- **liste d'hôtes autorisés** : un hôte n'est lu que s'il figure dans `session.json` (accord de l'utilisateur pour la session, posé par `geo.mjs autoriser`) ou dans `--hotes-autorises` ; sinon code de sortie 3 et message qui nomme l'hôte. `geo.mjs init` vide cette liste au début de chaque session ; les skills interdisent au modèle d'utiliser `--hotes-autorises` et `--autoriser-local` ;
- le nom est résolu, puis les adresses privées, de bouclage, lien-local (dont `169.254.0.0/16`, métadonnées cloud), `100.64.0.0/10`, `0.0.0.0/8`, `fd00::/8`, `fe80::/10`, `::1` et réservées sont **refusées**, sauf `--autoriser-local` (réservé aux sites de test) ;
- la vérification est refaite **à chaque redirection**, 10 au plus ; une redirection vers une adresse interne est refusée sans requête ;
- corps limité à 5 Mo, délai de 15 s, types de contenu attendus ;
- au moins 1 s entre deux requêtes au même hôte ; `robots.txt` du site respecté pour l'agent `geo-audit` (un `robots.txt` en erreur 5xx vaut interdiction) ; agent utilisateur honnête `geo-audit/0.1 (+https://github.com/kvarot/skills)`.

## Sortie bornée

Aucun texte de page brut n'arrive sur stdout. La sortie ne contient que des faits, des identifiants et des **extraits de 280 caractères au plus**, dans un objet `{ extrait, non_fiable: true }` : `<`, `>`, `&` et guillemets échappés, caractères de contrôle, invisibles, étiquettes Unicode et sélecteurs de variation retirés. Les rapports Markdown ne produisent aucun lien actif, aucune image ni lien de référence à partir du contenu d'une page ; le texte hostile n'y figure que sur des lignes « Extrait non fiable ». Un site de référence piégé par injection de prompt (`evals/sites/piege-injection`) vérifie ces points.

## Contenu non fiable et isolation du lecteur

Tout texte collecté est une donnée : il ne modifie jamais ce que font les skills. Le jugement qualitatif du contenu est confié à l'agent `lecteur-contenu`, qui n'a que l'outil de lecture (ni Bash, ni écriture, ni réseau) et renvoie un JSON que la session valide (forme, identifiants connus, doublons) avant usage. Une instruction trouvée dans une page est signalée comme alerte, jamais suivie.

**Limite assumée.** `geo.mjs` exporte les passages à juger dans le dossier `tmp/` du dossier de données ; la session principale, qui a des outils de lecture, pourrait **techniquement** lire ces fichiers. Le skill le lui interdit, et les tests d'injection vérifient que les sorties n'obéissent pas aux instructions piégées, mais ce n'est pas une barrière technique. Le dossier est vidé après usage (`exporter-contenu --purger`). Un lecteur de contenu mal piégé qui contournerait ces consignes pourrait donc influencer la session ; c'est pourquoi les avis du lecteur sont affichés à part des scores et n'en modifient aucun.

## Écritures

Seuls fichiers écrits : sous `.claude/geo/` du dossier courant, ou sous `GEO_HOME`. Toute écriture qui sortirait de ce dossier est refusée. Le plugin ne fait ni commit, ni push, ni déploiement, ni écriture en production, et n'écrit jamais dans `.claude/seo/`.

## Clés d'API et secrets

La version 0.1 n'utilise **aucune clé d'API** et ne lit aucun secret. Pour les versions suivantes (connecteurs, 0.2), la règle est posée dès maintenant : une clé se lit dans une variable d'environnement, n'est jamais écrite dans un fichier du plugin, dans la base, dans un rapport ni dans un journal, et n'est jamais envoyée à un autre hôte que celui de son service.

## Fausses idées

Les documents du plugin ne reprennent aucune affirmation de `donnees/idees-fausses.json` comme un fait ; un test le vérifie par expressions régulières, par phrase. C'est un garde-fou, pas une garantie : une reformulation inattendue peut lui échapper.

## Signaler un problème

Ouvrir un ticket sur le dépôt `kvarot/skills` ; pour une faille, le dire en une phrase sans publier de preuve d'exploitation, afin de laisser le temps de corriger.
