# Profil du projet (`.claude/seo/profil.md`)

Le profil est la mémoire du plugin sur le site audité : ce qu'il est, pour qui, avec quel ton, et ce que le développeur a confirmé. Il est écrit **uniquement** dans `.claude/seo/profil.md` du projet cible. Il se compose d'un front matter YAML (les champs ci-dessous) suivi d'un corps libre pour les notes.

Validation : `node <base du skill>/../../outils/seo.mjs profil-valider .claude/seo/profil.md` affiche `{ "valide": true|false, "erreurs": [...] }` ; code 0 si valide, 1 sinon.

## Champs obligatoires

| Champ | Type | Origine | Valeurs / remarque |
|---|---|---|---|
| `version` | nombre | fixe | doit valoir `1` |
| `stack` | texte | déduit (`detecter`) | `html-statique`, `php`, `twig`, `vue-spa`, `inconnue` |
| `rendu` | texte | déduit (`detecter`) | `statique`, `serveur`, `client`, `aucun` |
| `langues` | liste de textes | déduit, à confirmer | non vide, ex. `fr` |
| `public` | texte | **confirmé par le développeur** | à qui s'adresse le site |
| `offre` | texte | **confirmé par le développeur** | ce que le site propose |
| `ton` | texte | **confirmé par le développeur** | registre de rédaction attendu |
| `secteur` | texte | **confirmé par le développeur** | `sante`, `aucun` ou autre texte ; `sante` active les règles propres à la santé |
| `pays` | texte | **confirmé par le développeur** | code ISO sur 2 lettres majuscules, ex. `FR` |
| `outils` | objet | déduit de l'environnement | `search_console` et `navigateur`, chacun booléen (`oui`/`non`) |
| `confirme_le` | date ISO `AAAA-MM-JJ` | **confirmé par le développeur** | sa présence atteste que le discours (public, offre, ton, secteur) a été relu et validé |

## Champs optionnels

| Champ | Type | Remarque |
|---|---|---|
| `urls` | objet `{ dev, prod }` | URL http(s) valides ; la prod n'est lue qu'avec `--autoriser-prod` |
| `mots_cles` | objet type de page → liste de textes | ex. `accueil`, `service` |
| `termes_a_eviter` | liste de textes | formulations à ne pas écrire |
| `pages` | liste de `{ url, source }` | correspondance URL → fichier source |
| `historique` | liste de `{ date, lot, controles }` | lots déjà appliqués ; `controles` = ids de `controles.md` |

## Déduit ou confirmé

- **Déduit** : `stack`, `rendu`, `langues` (par `detecter`), `outils` (par l'environnement). Le skill les propose, le développeur peut les corriger.
- **Confirmé** : `public`, `offre`, `ton`, `secteur`, `pays`. Le skill ne les invente pas : il les demande, les reformule, puis fait confirmer. `confirme_le` n'est écrit qu'après cette confirmation ; sans lui, le profil est invalide et aucun contenu rédigé n'est proposé.

## Exemple complet (projet fictif)

```markdown
---
version: 1
stack: twig
rendu: serveur
langues:
  - fr
public: Habitants de Vallonnet cherchant un kinésithérapeute près de chez eux
offre: Rééducation, kinésithérapie du sport, soins à domicile
ton: Rassurant, clair, vouvoiement, sans jargon
secteur: sante
pays: FR
outils:
  search_console: non
  navigateur: oui
confirme_le: 2026-03-12
urls:
  dev: http://localhost:8080
  prod: https://cabinet-exemple.test
mots_cles:
  accueil:
    - kinésithérapeute Vallonnet
    - rééducation
  service:
    - kinésithérapie du sport
    - soins à domicile
termes_a_eviter:
  - guérison garantie
  - le meilleur
pages:
  - url: /
    source: templates/accueil.html.twig
  - url: /soins-a-domicile
    source: templates/soins.html.twig
historique:
  - date: 2026-03-14
    lot: meta
    controles: [T-TITLE-ABSENT, T-DESC-ABSENT]
---

Notes libres : le cabinet est fictif, le site est refait à la main, le sitemap est généré par le script de déploiement.
```
