# Fiche d'adaptation d'un produit (`adaptateur.json`)

Tout ce qui est propre à un produit tient dans un fichier JSON, gardé **hors** du dépôt public de skills s'il contient quoi que ce soit de privé. Les chemins sont relatifs au fichier.

```json
{
  "produit": "demo",
  "binaire": "build/app.exe",
  "verifier_build": "build/build.json",
  "instance": {
    "commande": ["node", "demarrer-instance.mjs", "{travail}", "{port}"],
    "url_regex": "(http://127\\.0\\.0\\.1:\\d+/\\S*)",
    "masquer_regex": "token=([0-9a-f]+)",
    "env": { "APP_BIN": "{bin}" }
  },
  "verite": { "commande": ["node", "valider.mjs", "{bin}", "{travail}/data", "{run}"] },
  "parcours": { "premier-lancement": "parcours/premier-lancement.md" },
  "personas": ["debutant", "developpeur-senior", "expert-domaine", "malvoyante-clavier"],
  "defauts": "defauts-semes.json",
  "interdits": "interdits.txt",
  "aide_regex": "aide|help|faq|guide",
  "chemin_reference": { "premier-lancement": 7 },
  "depot_produit": "../code-du-produit"
}
```

| Clé | Rôle | Obligatoire |
|---|---|---|
| `instance.commande` | Lance **une instance neuve, données fictives**, dans `{travail}` sur `{port}` ; doit imprimer l'adresse de départ. Le banc arrête tout l'arbre de processus et supprime `{travail}` après chaque exécution | oui |
| `instance.url_regex` | Capture l'adresse de départ dans la sortie de la commande | oui |
| `instance.masquer_regex` | Capture un secret de session (jeton) à masquer dans tous les journaux | si l'adresse en contient un |
| `binaire`, `verifier_build` | Produit construit **depuis un commit**, interface comprise, dans un worktree propre ; `build.json` doit valoir `{"ok": true, "commit": "…"}` après trois preuves (révision enregistrée, version affichée, fichiers de la page embarqués). Sinon la campagne refuse de partir | recommandé |
| `verite.commande` | Validateur : lit l'état réel (CLI, API, base en lecture) et écrit `{run}/validation.json` (`verdicts[]` : vrai / faux / non vérifiable) | recommandé |
| `parcours` | Un fichier par parcours : **un objectif d'utilisateur**, sans libellé d'interface ni chemin ; une section `## Réponse` facultative décrit les champs `specifique` attendus | oui |
| `personas` | Liste de fiches (dossier de la skill) ou chemin d'un dossier de fiches propres au produit | non |
| `defauts` | Défauts semés pour `proxy-defauts.mjs` (au moins un fonctionnel, un UX, un faux succès) | pour les passages semés |
| `interdits` | Un terme par ligne : libellés d'écran, routes, noms internes qui ne doivent apparaître ni dans un parcours ni dans une fiche (contrôle anti-fuite, refus au lancement) | recommandé |
| `chemin_reference` | Nombre minimal d'interactions (souris) pour réussir le parcours ; sert à compter les étapes superflues. Fourni par l'agent expert | non |
| `depot_produit` | Code et docs du produit, lus **seulement** par l'agent expert | pour le mode approfondi |

## Défauts semés (`defauts.json`)

```json
{
  "masquer":    [{ "chemin": "^/api/items", "contient": "ID-123" }],
  "remplacer":  [{ "chemin": "\\.js$", "de": "Voir les résultats", "vers": "Afficher l'inventaire technique" }],
  "fauxSucces": [{ "methode": "POST", "chemin": "^/api/items/[^/]+/decision$", "corps": "relire-puis-modifier" }]
}
```

Le proxy n'écoute que sur 127.0.0.1 et ne modifie jamais le produit : il réécrit les réponses en transit.
