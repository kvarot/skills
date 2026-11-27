# Lire les scores de potentiel

La sortie de `calculerScores` est une liste de dix scores, toujours dans le même ordre : `seo-technique`, `acces-ia`, `qualite-semantique`, `potentiel-citation`, `identite-numerique`, `couverture-intentions`, puis les quatre scores mesurés (`autorite-thematique`, `reputation-externe`, `positionnement-concurrentiel`, `visibilite-mesuree`).

Chaque score : `{ id, valeur, couverture, criteres, version_poids, raison? }`.

- `valeur` : entier de 0 à 100, ou `null` quand la couverture est inférieure à 0,5 ou que le score exige une mesure.
- `couverture` : part du poids des critères effectivement calculés (0 à 1). Une couverture basse signifie « peu de choses ont pu être évaluées », pas « le site est mauvais ».
- `criteres` : `{ id, classe, poids, acquis, preuve }`. `acquis: null` = non calculé (donnée absente, langue non prise en charge, vérification non faite). `preuve` nomme les constats et les nombres de pages utilisés.
- `version_poids` : version de `donnees/poids.json`. Ne pas comparer des scores de versions différentes.

Règles de lecture pour le rapport :

- Toujours afficher la couverture à côté de la valeur, et lister les critères non calculés.
- Une langue non prise en charge fait baisser la couverture des critères de contenu ; ne jamais combler par un jugement.
- Les scores de potentiel et la visibilité mesurée ne s'additionnent pas et ne se présentent pas comme une prévision.
- Phrase fixe à reprendre dans les limites : un score de potentiel élevé ne garantit aucune citation.
- `GEO-LLMSTXT` et `GEO-CONTENT-SIGNAL` n'entrent dans aucun score.

Méthode complète, regroupements et justification des poids : `plugins/geo/SCORING.md`.
