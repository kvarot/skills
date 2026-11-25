# Stack : Twig

Gabarits `.twig` rendus côté serveur (PHP). Détecté dès qu'un fichier `.twig` est présent hors `vendor`.

## 1. Où naît le HTML

Un contrôleur ou un routeur choisit un gabarit et lui passe des variables ; Twig produit le HTML. La structure se lit dans les gabarits : un **gabarit de base** (`base.html.twig`, `layout.twig`) ouvre `<html>` et `<head>`, les gabarits enfants font `{% extends %}` et remplissent des blocs.

## 2. Où vivent title et meta

Dans le gabarit de base, sous forme de blocs surchargeables avec une valeur par défaut :

```twig
<html lang="{{ app.locale|default('fr') }}">
<head>
  <title>{% block title %}Nom du cabinet{% endblock %}</title>
  {% block meta %}
    <meta name="description" content="{% block description %}{% endblock %}">
  {% endblock %}
  {% block canonical %}{% endblock %}
</head>
```

Chaque enfant surcharge ce qui lui est propre :

```twig
{% extends 'base.html.twig' %}
{% block title %}{{ 'page.contact.title'|trans }} – Nom du cabinet{% endblock %}
{% block description %}{{ 'page.contact.description'|trans }}{% endblock %}
```

Pour plusieurs langues, passer par `trans` (fichiers de traduction) plutôt que par du texte en dur ; `lang` et les liens `hreflang` suivent la locale courante. Une valeur dynamique (`{{ service.nom }}`) est échappée automatiquement : ne pas la marquer `|raw` sans nécessité.

Avant d'ajouter un bloc, regarder ceux qui existent : inclusions (`{% include 'partials/head.html.twig' %}`), macros, variables globales.

## 3. Ajouter sitemap et robots

- `robots.txt` : fichier statique dans le dossier public, avec la ligne `Sitemap:`.
- `sitemap.xml` : une route et un gabarit `.xml.twig` qui bouclent sur les pages publiques, ou un fichier statique pour un site stable. Les URL doivent être absolues.

## 4. Relier une URL à sa source

URL, puis route (fichier de routes, attributs ou annotations du contrôleur), puis contrôleur, puis gabarit rendu, puis gabarit de base hérité. Le nom du gabarit apparaît dans l'appel `render` du contrôleur. Plusieurs URL peuvent partager un gabarit : un correctif de title s'applique alors au contrôleur ou au bloc, pas à un fichier par page.

## 5. Pièges connus

- Bloc `title` non surchargé : toutes les pages partagent le title de la base.
- Bloc défini dans l'enfant hors de tout bloc parent : ignoré silencieusement.
- Clé de traduction manquante : la clé brute s'affiche à la place du texte.
- `lang` fixe alors que la page est traduite.
- Canonical construit à partir de l'URI de la requête : il inclut les paramètres ; préférer une URL de référence explicite.
- Gabarits en cache : le rendu observé peut dater d'avant la modification.
- Gabarits partiels (`partials/`) sans `<html>` : les distinguer des gabarits de page.
