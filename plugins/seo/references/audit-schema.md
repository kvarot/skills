# Formats des fichiers d'audit

Les deux fichiers sont écrits **uniquement** sous `.claude/seo/` du projet cible, tant qu'aucun lot n'est validé.

## `audit.json`

```
{ date, stack, constats: [ Constat & { fichier_source, correction_proposee } ] }
```

- `date` : date ISO `AAAA-MM-JJ` de l'audit, remplie par le skill.
- `stack` : la chaîne `stack` du résultat de `detecter` (ex. `twig`), remplie par le skill ; `null` si non détectée. `auditer` renvoie toujours `stack: null`.
- `constats` : un élément par problème constaté.

Un **Constat** (produit par `auditer`) :

| Champ | Type | Remarque |
|---|---|---|
| `controle` | texte | id du catalogue `controles.md`, ex. `T-TITLE-ABSENT` |
| `severite` | texte | `bloquant`, `important` ou `mineur` |
| `lot` | texte | lot de correction, ex. `meta`, `indexation`, `structure` |
| `pages` | liste de textes | pages concernées (URL ou chemin) |
| `preuve` | texte | ce qui a été observé, vérifiable |
| `priorite` | nombre | poids de la sévérité (`bloquant` 3, `important` 2, `mineur` 1) × nombre de pages concernées ; la plus haute se traite en premier |

Ajoutés par le skill, après lecture du code : `fichier_source` (fichier à modifier, relatif à la racine du projet) et `correction_proposee` (texte de la correction, issu de `controles.md` et adapté au projet).

Règles de forme :

- `fichier_source` : **un seul chemin**, relatif à la racine, sans numéro de ligne, ni parenthèse, ni commentaire (`index.html`, pas `index.html (lignes 21-25)` ni `a.html, b.html`). Un défaut corrigé dans plusieurs fichiers donne **un constat par fichier**, même `controle`, avec les `pages` qui viennent de ce fichier. Exception : un défaut qui vient d'un **gabarit partagé** (layout, gabarit de base, en-tête inclus : title ou description par défaut repris sur toutes les pages, `lang` absent) a pour `fichier_source` ce gabarit partagé, en un seul constat ; les pages ou gabarits enfants à retoucher sont nommés dans `correction_proposee`. Un fichier à créer (`sitemap.xml`) est cité par le chemin qu'il aura. La ligne et les précisions vont dans `preuve`.
- `controle` : l'id **exact** du catalogue, sans annotation ; un constat trouvé par lecture du code garde son id et le dit dans `preuve`. Un problème sans id au catalogue ne va pas dans `audit.json` : le signaler dans la réponse.
- Chaque audit, relance comprise, **réécrit** `audit.json` en entier avec les constats du moment.

Exemple :

```json
{
  "date": "2026-03-14",
  "stack": "twig",
  "constats": [
    {
      "controle": "T-TITLE-ABSENT",
      "severite": "bloquant",
      "lot": "meta",
      "pages": ["/soins-a-domicile"],
      "preuve": "aucune balise <title> dans la page",
      "priorite": 3,
      "fichier_source": "templates/soins.html.twig",
      "correction_proposee": "Ajouter un <title> unique et descriptif dans le <head>."
    }
  ]
}
```

## `contenus-a-saisir.md`

Textes à rédiger ou valider par le développeur, jamais appliqués automatiquement. Un tableau, une ligne par champ à renseigner :

| page | champ | texte actuel | texte proposé | raison |
|---|---|---|---|---|

Exemple :

| page | champ | texte actuel | texte proposé | raison |
|---|---|---|---|---|
| /soins-a-domicile | title | (absent) | Soins à domicile à Vallonnet, kinésithérapeute | T-TITLE-ABSENT : titre unique de 30 à 60 caractères |
