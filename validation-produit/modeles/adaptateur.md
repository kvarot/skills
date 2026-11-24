# Fiche d'adaptation d'un produit (modèle)

Une fiche par produit, gardée **hors** du dépôt public de skills si elle contient quoi que ce soit de privé.

- **Construction depuis un commit** : commande qui construit le produit testé, interface comprise, depuis un commit donné dans un worktree propre, et prouve que le résultat porte ce commit et cette interface (révision enregistrée, version affichée, fichiers de la page embarqués). Le passage refuse un produit sans cette preuve.
- **Instance jetable** : commande qui lance une instance neuve avec données fictives, et la ligne qu'elle imprime avec l'adresse de départ.
- **Arrêt et nettoyage** : comment l'arrêter (arbre de processus) et quels dossiers supprimer.
- **Parcours** : objectif en une phrase d'utilisateur, avec `{URL}` pour l'adresse de départ.
- **Vérité** : comment le validateur lit l'état réel (commande CLI en JSON, API, base en lecture) et quelles affirmations du persona il vérifie.
- **Défauts semés** : fichier pour `proxy-defauts.mjs` (un fonctionnel, un UX, un faux succès), avec ce qu'un bon test doit remarquer.
- **Interdits propres au produit** : services externes à ne jamais appeler, données à ne jamais montrer.
