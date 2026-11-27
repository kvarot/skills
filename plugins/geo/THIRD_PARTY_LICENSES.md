# Licences et sources tierces

## Aucun code tiers n'est copié

Le plugin `geo` est sous licence MIT ([LICENSE](LICENSE)). **Aucune ligne de code d'un projet tiers n'y a été copiée.** Les projets ci-dessous ont été lus (code ou documentation) pendant le benchmark du 2026-11-27 ([docs/geo/0-benchmark.md](../../docs/geo/0-benchmark.md)) ; seules leurs **idées** ont été retenues puis réimplémentées. Une idée n'est pas protégée par la licence du code ; les projets sont cités par courtoisie et pour la traçabilité. Les projets sans licence ou sous licence copyleft n'ont servi qu'à des idées, ou n'ont pas été lus.

Les jeux de données publiés par ces projets (registre de robots, par exemple) n'ont pas été copiés : `donnees/robots.json` est reconstruit à partir des documentations officielles des éditeurs, chaque entrée portant sa source et la date de vérification.

## Code adapté d'un autre plugin du même dépôt

Quatre modules d'outils (`outils/lib/reseau.mjs`, `extraire.mjs`, `robots.mjs`, `collecter.mjs`) et `evals/eval-declenchement.mjs` sont adaptés de `plugins/seo/` : **même auteur, licence MIT**. L'origine est indiquée en commentaire de tête de chaque fichier (`Adapted from plugins/seo/outils/<fichier>.mjs (same author, MIT)`). Le script d'évaluation de déclenchement s'inspire aussi du lanceur du dépôt `anthropics/skills` (Apache-2.0), cité dans son commentaire de tête ; aucun code n'en est copié.

## Projets dont des idées ont été reprises

| Projet | Licence | Idées retenues |
|---|---|---|
| [`zubair-trabzada/geo-seo-claude`](https://github.com/zubair-trabzada/geo-seo-claude) | MIT | détecter un `robots.txt` réécrit par un CDN ; vérifier l'entité par l'API Wikidata ; type d'activité qui change l'ordre des constats |
| [`seo-skills/geo-audit-skill`](https://github.com/seo-skills/geo-audit-skill) | MIT | critère non calculable absent plutôt que 0, avec une couverture ; classes de signaux (déterministe, heuristique) ; constantes versionnées et refus de comparer des versions différentes ; frontière de sortie (aucun texte de page brut, extraits bornés et échappés) ; détecteur de texte à allure d'instruction ; garde SSRF avant et après connexion |
| [`thevibegarage/geo-visibility-skill`](https://github.com/thevibegarage/geo-visibility-skill) | MIT | correspondance `robots.txt` selon la RFC 9309 ; comparaison du rendu selon l'agent utilisateur ; jeu de requêtes figé avec quotas ; tableau « à corriger d'abord » en tête de rapport |
| [`rankxai/seo-geo-skills`](https://github.com/rankxai/seo-geo-skills) | MIT (avec `NOTICE`) | forme du registre de robots (jeton, rôle, citation de l'éditeur, date de vérification) ; registre des idées fausses (motif, raison, source, date) ; codes de sortie 0 / 1 / 2 / 3 ; caractères invisibles ; requêtes avec et sans marque séparées |
| [`rampstackco/claude-skills`](https://github.com/rampstackco/claude-skills) | MIT | « une donnée indisponible dite comme telle est une réponse complète ; ne jamais fabriquer un nombre » |
| [`limelit-co/open`](https://github.com/limelit-co/open) | Apache-2.0 | exclusion des requêtes avec marque des chiffres principaux ; garde « nom-phrase » ; jeu de requêtes par gabarits déterministes (la mesure elle-même arrive en 0.2) |
| [`elmohq/elmo`](https://github.com/elmohq/elmo) | MIT | réponses brutes conservées, tables dérivées reconstruisibles avec tampon de version (prévu pour la mesure) |
| [`danishashko/geo-aeo-tracker`](https://github.com/danishashko/geo-aeo-tracker) | MIT | intervalle de confiance sur un taux de présence (prévu pour la mesure) |
| [`aws-samples/sample-llm-search-citation-analysis-with-amazon-bedrock`](https://github.com/aws-samples/sample-llm-search-citation-analysis-with-amazon-bedrock) | MIT-0 | texte de synthèse limité aux faits calculés (prévu pour la mesure) |
| [`yaojingang/GEOInflow`](https://github.com/yaojingang/GEOInflow) | MIT | séparer agent déclaré, plage IP et preuve DNS dans les logs ; un log prouve l'accès, pas la citation (prévu en 0.3) |
| [`onvoyage-ai/gtm-engineer-skills`](https://github.com/onvoyage-ai/gtm-engineer-skills) | MIT | contrat strict du fichier de requêtes, validé par un test |
| `Didgeheads/geo-skill`, `aelena/seo-geo-audit` | aucune licence | **idées seulement** : citations `fichier:ligne`, identifiants de contrôle stables, plafond de déduction par contrôle, refus de laisser un champ à remplir dans le JSON-LD inséré (la partie correction est prévue en 0.3) |

Non lus et rien repris : `Open-Source-SEO-Tools/ai-visibility-tracker` (AGPL-3.0), les dépôts sans licence listés dans le benchmark.

## Sources de faits

Les faits sur les plateformes (registre des robots, `llms.txt`, consignes de Google et de Bing, études sur le GEO) viennent des documentations officielles et des publications citées, avec leur URL et leur classe de preuve, dans [docs/geo/0-benchmark.md](../../docs/geo/0-benchmark.md), `donnees/robots.json` et `donnees/idees-fausses.json`.
