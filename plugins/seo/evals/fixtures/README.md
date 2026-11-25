# Fixtures SEO à défauts semés

Cinq mini-sites d'un cabinet de kinésithérapie fictif : `html-statique`, `php`, `twig`, `vue-spa` (défauts semés) et `propre` (aucun défaut). Chaque dossier contient un `verite.json`.

## Format de `verite.json`

```json
{ "langue": "fr", "pays": "GB", "rendu_local": "dossier", "racine_rendu": "dist",
  "defauts": [ { "controle": "T-…", "fichier_source": "…", "detection": "controle", "verif_apres": { … } } ] }
```

- `rendu_local` : `dossier` (collecte du dossier), `php-s` (servi par `php -S`, collecte HTTP) ou `aucun` (code seul).
- `racine_rendu` (optionnel) : sous-dossier à collecter à la place de la racine (vue-spa : `dist`).
- `pays` (optionnel) : code pays implicite (twig : `GB`).
- Une entrée de `defauts` = un défaut attendu. Un même identifiant de contrôle peut apparaître dans plusieurs entrées.

### `detection` : comment le défaut est trouvé

- `controle` : trouvé de façon déterministe par la collecte puis `controler`. La section 7 de `test-outils.mjs` vérifie chacun.
- `modele` : seul le modèle peut le trouver (lecture du code source).

### `verif_apres` : comment la correction est vérifiée (indépendant de `detection`)

- `{ "type": "controle" }` : après correction, recollecter et relancer `controler` ; le constat doit avoir disparu.
- `{ "type": "motif", "fichier", "present"?, "absent"? }` : contrôle d'un fichier source par regex.
- `{ "type": "explication", "motif_reponse" }` : le défaut ne se corrige pas dans les sources (ex. `dist/` est un build versionné) ; la réponse du modèle doit expliquer le problème et correspondre à la regex.

## Ce que doit faire le harnais de la tâche 12

- Compiler toutes les regex (`present`, `absent`, `motif_reponse`) avec les flags `im`.
- `fichier` peut être un dossier : chercher récursivement.
- Évaluer `present` ET `absent` quand les deux sont fournis.
- Une entrée = un défaut attendu (identifiants en double autorisés).
- Respecter `racine_rendu` : collecter `<fixture>/<racine_rendu ?? '.'>`.
- Fixtures `php-s` : servir avec `php -S 127.0.0.1:<port libre> -t <fixture>` et collecter avec `collecterUrl`.
