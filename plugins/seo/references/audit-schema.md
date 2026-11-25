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
