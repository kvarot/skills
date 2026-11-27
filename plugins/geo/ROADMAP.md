# Feuille de route

Chaque version est utilisable seule, testée, relue, puis publiée. Le contenu des versions à venir est un **plan**, pas une promesse de date ; rien de ce qui suit n'existe en 0.1.

## 0.1 (cette version)

Socle, sécurité réseau, collecte, audit technique, robots IA et registre, entités et données structurées, contenu (français et anglais), scénarios, base SQLite, rapports Markdown et JSON, scores de potentiel, mode gratuit complet. Voir [CHANGELOG.md](CHANGELOG.md).

## 0.2 : mesure

- Connecteurs d'API des assistants, plus les modes `session` (modèle de la session) et `manuel` (réponses collées ou importées) ; estimation de coût et accord avant tout appel facturable, plafond de dépense.
- Exécution du jeu de scénarios figé, réponses brutes conservées (texte, citations, modèle, date, langue), extraction déterministe des mentions et des citations.
- Statistiques : taux de présence avec intervalle de confiance, jamais un rang seul ; échantillonnage répété.
- Visibilité, citations, concurrents (confirmés par l'utilisateur, audités avec le même moteur).
- Les quatre scores « mesurés » cessent de valoir `null` quand la mesure existe.

## 0.3 : diagnostic et correction

- `why-not` : diagnostic des causes sur preuves, plan d'action priorisé.
- Corrections en diff (niveau 3) et application vérifiée (niveau 4), délégation au plugin `seo` pour les corrections SEO classiques.
- Expériences avant / après avec témoins, historique, régressions, suivi par ordonnanceur externe, logs de serveur (visites de robots vérifiées), exports CSV et HTML.

## 0.4 : durcissement

Sécurité et performances renforcées, documentation complète, scripts d'installation Windows / Linux / macOS, comparaison aux outils libres sur les mêmes sites de référence.

## Hors périmètre

Annonces de rang, promesses de citation, achat de mentions, scraping des interfaces grand public des assistants.
