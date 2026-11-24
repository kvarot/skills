# Fiche persona (schéma)

Une fiche = un fichier Markdown avec un en-tête YAML simple (clé: valeur, listes, un niveau d'imbrication). `node outils/persona.mjs <fiche>` la valide et affiche ce que le banc imposera.

| Champ | Valeurs | Effet |
|---|---|---|
| `id`, `role` | `role`: `utilisateur`, `verificateur` (rejoueur), `temoin` (groupe témoin d'évaluation) | `temoin` : aucune règle ni fiche transmise |
| `metier`, `experience` | texte | contexte du personnage |
| `niveau_informatique` | `bas` \| `moyen` \| `eleve` | |
| `connaissance_logiciel` | `aucune` \| `notions` \| `habituelle` | ce qu'il sait du produit **avant** de commencer |
| `connaissance_metier` | texte | ce qu'il sait du domaine |
| `objectifs`, `attentes` | listes | |
| `contraintes_temps` | texte | |
| `environnement.appareil`, `.ecran` (`LxH`), `.saisie` (`souris` \| `clavier-seul` \| `tactile`) | | **imposé** : taille de fenêtre ; clavier seul retire les outils de clic et de remplissage |
| `accessibilite.zoom` (100-400), `.clavier_seul`, `.lecteur_ecran` | | **imposé** : le zoom réduit la fenêtre CSS (même mise en page qu'un zoom réel) |
| `patience` | `basse` \| `moyenne` \| `haute` | **imposé** : 20 / 30 / 45 interactions (×3 au clavier seul), puis le hook arrête le persona |
| `tolerance_erreurs` | `basse` \| `moyenne` \| `haute` | |
| `strategie_recherche` | texte | comment il cherche (titres, recherche, Tab…) |
| `seuil_abandon` | texte | quand il abandonne |
| `criteres_satisfaction` | liste | repris dans `satisfaction` de la réponse |
| `vocabulaire_connu`, `vocabulaire_inconnu` | listes (facultatif) | un mot inconnu non expliqué à l'écran n'est pas compris |

## Ce qui n'est pas simulé (dire quand ça compte)

- Le toucher (seule la taille d'écran est imposée), le débit réseau et la puissance du processeur (non émulés par ce banc), un vrai lecteur d'écran (approché par l'arbre d'accessibilité), la fatigue, la mémoire d'une visite précédente.
- Une fiche ne rend pas un modèle débutant : la recherche montre que les utilisateurs simulés réussissent plus et plus directement que les humains (voir `limites.md`). Les lignes de pas qui demandent « où ta personne hésiterait » compensent en partie, sans plus.

## Anti-fuite

La fiche et le parcours ne contiennent **aucun** libellé d'écran, route ou nom interne : `lancer-persona.mjs` refuse de partir si un terme de la liste `interdits` de l'adaptateur y figure, ou si le parcours contient un chemin interne.
