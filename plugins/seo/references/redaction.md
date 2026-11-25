# Règles de rédaction SEO

Règles suivies par `seo-contenu` pour toute valeur de texte : title, meta description, libellé des Hn, `alt`, ancres de liens, FAQ, enrichissement des pages pauvres. Les longueurs et les identifiants viennent de `controles.md`. Si `secteur: sante`, `secteurs/sante.md` s'ajoute à ces règles ; en cas de conflit, la règle la plus prudente l'emporte.

## 1. Rien d'inventé

Un texte proposé ne contient que des faits **présents dans le projet** (templates, fichiers de traduction, pages existantes, README, configuration) ou **dans le profil** (`public`, `offre`, `ton`, `mots_cles`, notes). Pour chaque fait, noter le fichier d'où il vient.

**Interdits s'ils sont absents du projet** : signalés au développeur, **jamais écrits**, ni dans le texte, ni en commentaire, ni sous forme de valeur provisoire (`[à compléter]`, `XX €`).

| Interdit | Pièges courants |
|---|---|
| chiffre, nombre | « plus de … patients », « … ans d'expérience », « … séances suffisent » |
| prix, tarif, remboursement | « à partir de … € », « pris en charge à 100 % » |
| durée | durée d'une séance, d'un traitement, délai de rendez-vous |
| ancienneté | « depuis … », « fondé en … », « … ans d'expérience » |
| résultat | taux de réussite, « soulagement rapide », « résultats garantis » |
| avis, note, témoignage | « nos patients nous recommandent », étoiles, citations de clients |
| label, certification, diplôme, affiliation, distinction | « certifié … », « membre de … », « agréé … » |
| superlatif non vérifiable | « le meilleur », « n°1 », « leader », « le plus réputé » |

Un nombre peut être écrit **seulement s'il est recopié du projet** (adresse, téléphone, horaires, prix affichés), à l'identique, avec son fichier source.

## 2. Langue et ton

- Écrire dans la langue **de la page** : `lang` du document, locale de la route ou du fichier de traduction, à défaut `langues` du profil. Jamais dans la langue de la conversation par défaut.
- Site multilingue : un texte par langue du profil, rangé là où le projet range ses traductions (fichiers `trans`, `i18n`, dictionnaires) ; ne pas laisser une langue sans texte ni recopier le texte d'une langue dans une autre.
- Suivre `ton` du profil (registre, tutoiement ou vouvoiement, niveau de technicité). Ne jamais employer un terme de `termes_a_eviter`.

## 3. Intention de recherche

Chaque texte répond à ce que cherche la personne qui arrive sur la page :

| Type de page | Intention | Ce que le texte doit dire |
|---|---|---|
| accueil | trouver ce professionnel ou ce type de service à cet endroit | qui, quoi, où |
| service, soin, prestation | comprendre le service, savoir s'il est proposé ici | ce que c'est, pour qui, où |
| contact, accès | venir ou joindre | adresse, moyens de contact, prise de rendez-vous si le projet en propose |
| article, information | obtenir une réponse | la question traitée, sans promesse |

## 4. Un mot-clé principal par page

- Un seul mot-clé principal par page, pris dans `mots_cles` du profil pour ce type de page ; à défaut, tiré du sujet réel de la page. Deux pages ne visent pas le même mot-clé principal.
- Il apparaît naturellement : en tête du title si la phrase le permet, dans le `<h1>`, dans la description, dans le premier paragraphe.
- **Pas de bourrage** : une fois dans le title, une ou deux fois dans la description, pas de liste de villes ou de variantes, pas de répétition dans les `alt` ou les ancres. Une phrase doit rester lisible à voix haute.

## 5. Longueurs et unicité

| Champ | Règle | Contrôle |
|---|---|---|
| title | 30 à 60 caractères, unique sur le site, sujet de la page en tête, nom du site ou du cabinet en fin si la place le permet | T-TITLE-LONGUEUR, T-TITLE-DOUBLON |
| meta description | 70 à 160 caractères, unique, résume la page en une ou deux phrases, invite à l'action sans pression | T-DESC-LONGUEUR, T-DESC-DOUBLON |
| `<h1>` | un seul, décrit le sujet de la page ; peut différer du title | T-H1-ABSENT |
| `<h2>`… | décrit la section qu'il ouvre | — |

Compter les caractères du texte **rendu** (entités décodées, variables remplacées). Le niveau des titres (h1, h2…) appartient à `seo-technique` : ici on n'en change que le libellé.

## 6. Texte alternatif des images

- Image informative : `alt` court (une phrase au plus) qui dit ce que l'image apporte à la page, sans « image de » ni « photo de ».
- Image décorative (fond, séparateur, icône doublée d'un texte) : `alt=""`.
- Image-lien : l'`alt` décrit la destination du lien.
- Pas de mot-clé plaqué, pas de nom de personne ni de détail identifiant un patient que le projet n'affiche pas déjà.

## 7. Ancres de liens

- L'ancre décrit la page cible : « Tarifs et remboursement », « Venir au cabinet », pas « cliquez ici ».
- Ancres génériques à remplacer (C-ANCRE-GENERIQUE) : « cliquez ici », « ici », « en savoir plus », « lire la suite », « click here », « here », « read more ».
- Une même cible garde une ancre cohérente d'une page à l'autre ; pas la même ancre-mot-clé exacte sur tous les liens.

## 8. FAQ

- Questions et réponses construites **uniquement** à partir d'informations du projet (pages, profil, notes) ; chaque réponse cite son fichier source.
- Pas de conseil personnalisé, pas de diagnostic, pas de réponse qui dépasse ce que le projet affirme.
- Une FAQ n'existe que si elle est **visible sur la page**. Le balisage `FAQPage` est à `seo-donnees-structurees`.

## 9. Pages pauvres (C-PAGE-PAUVRE, moins de 300 mots visibles)

- Enrichir avec ce que le projet sait déjà : ce qu'est le service, pour qui (`public`), où et comment venir, liens vers les pages voisines pertinentes.
- Si le projet n'a pas assez de faits pour une page utile : poser au développeur les **questions précises** qui manquent, ou proposer de fusionner la page avec une page voisine. Jamais de remplissage générique pour atteindre un nombre de mots.

## 10. Contrôle avant présentation

1. Chaque nombre du texte proposé est retrouvé dans le projet (fichier cité) ; sinon il est retiré et signalé.
2. Aucun interdit du § 1, aucun terme de `termes_a_eviter`, règles du secteur respectées.
3. Longueurs et unicité du § 5 vérifiées sur le texte rendu.
4. Langue de chaque texte = langue de la page.
5. Mot-clé principal présent sans répétition au-delà du § 4.
