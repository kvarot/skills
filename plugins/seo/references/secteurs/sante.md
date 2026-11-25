# Secteur santé

Activé par `secteur: sante` dans le profil. Lu par `seo-contenu` (textes) et `seo-donnees-structurees` (types schema.org, § 4).

- **Partie générique (§ 1)** : s'applique toujours, quel que soit le pays.
- **Section `FR` (§ 2)** : s'ajoute quand `pays: FR`.
- **Tout autre `pays` (§ 3)** : partie générique seule, et le dire.

Ce fichier n'est pas un avis juridique. Les textes cités l'ont été à la date de consultation indiquée (§ 5) ; ils peuvent avoir changé. Le professionnel reste responsable de sa communication : en cas de doute, il interroge l'ordre ou l'organisme de sa profession.

## 1. Partie générique (tous pays)

1. **Aucune promesse** de guérison, de soulagement, de résultat ou de délai de résultat (« guérir », « résultats garantis », « soulagement en … séances »).
2. **Aucune comparaison dénigrante** avec d'autres professionnels, cabinets ou établissements ; pas de comparaison de tarifs, de délais ou d'actes.
3. **Aucun témoignage ni avis** présenté comme preuve d'efficacité ; pas de note, d'étoiles, de remerciements de patients.
4. **Prudence sur les termes médicaux** : nommer ce que le projet nomme, sans élargir les indications ; pas de diagnostic, pas de conseil personnalisé ; une information de santé générale reste factuelle et ne présente pas une hypothèse comme acquise.
5. **Pas de formulation anxiogène** (peur, urgence fabriquée, « avant qu'il ne soit trop tard »).
6. **Pas de superlatif** : « le meilleur », « n°1 », « leader », « le plus expérimenté ».
7. **Prix, remboursements, spécialités, diplômes, titres** : seulement s'ils sont affichés par le projet, recopiés à l'identique.
8. **Pas de patient identifiable** (nom, photo, cas décrit) dans un texte rédigé.
9. Ton informatif plutôt que promotionnel : le texte aide la personne à choisir et à venir, il ne « vend » pas un soin.

## 2. Section `FR` (France)

Pour les professions de santé en France, la communication au public est encadrée par le code de déontologie de chaque profession (partie réglementaire du code de la santé publique) et par les recommandations de l'ordre concerné. **Les règles diffèrent selon la profession** : identifier la profession du projet (profil `offre`, pages) avant d'appliquer une sous-section. Profession non couverte ci-dessous : partie générique, et demander au développeur de vérifier les règles de sa profession.

### 2.1 Masseurs-kinésithérapeutes (sources vérifiées)

Sources : décret n° 2020-1663 du 22 décembre 2020 (JORF du 24 décembre 2020, texte n° 59) et recommandations du Conseil national de l'ordre des masseurs-kinésithérapeutes (CNOMK) relatives à la communication, 2e édition consolidée à l'issue du Conseil national du 15 décembre 2022 (§ 5, sources S1 et S2).

- **Liberté encadrée** (art. R. 4321-67-1, I, tel que créé par le décret) : le masseur-kinésithérapeute « est libre de communiquer au public, par tout moyen, y compris sur un site internet, des informations de nature à contribuer au libre choix du praticien par le patient » ; cette communication « est loyale et honnête, ne fait pas appel à des témoignages de tiers, ne repose pas sur des comparaisons avec d'autres masseurs-kinésithérapeutes ou établissements et n'incite pas à un recours inutile à des actes de prévention ou de soins. Elle ne porte pas atteinte à la dignité de la profession et n'induit pas le public en erreur. »
- **Information de santé** (art. R. 4321-67-1, II) : informations « scientifiquement étayées », formulées « avec prudence et mesure », sans présenter « comme des données acquises des hypothèses non encore confirmées ».
- **Pas de commerce** (art. R. 4321-67, cité par S2) : « La masso-kinésithérapie ne doit pas être pratiquée comme un commerce » ; selon S2, les sites internet ne doivent « en aucune façon présenter un caractère promotionnel, ou commercial ».
- **Référencement** (art. R. 4321-123, II) : « Il est interdit au masseur-kinésithérapeute d'obtenir contre paiement ou par tout autre moyen un référencement numérique faisant apparaître de manière prioritaire l'information le concernant dans les résultats d'une recherche effectuée sur l'internet. » S2 (annexe 4, « Référencement du site ») ajoute que « toute démarche » visant à faire apparaître le site « de manière prioritaire » est prohibée, ainsi que tout service visant à le placer parmi les liens sponsorisés ou en tête d'un annuaire en ligne.
  **Conséquence pour le plugin** : se limiter à rendre le site lisible et exact (mécanismes corrects, textes qui décrivent fidèlement la page) ; ne proposer ni lien sponsorisé, ni annuaire payant, ni texte écrit pour « passer devant » d'autres praticiens. Les textes cités ne précisent pas la portée de cette interdiction pour l'optimisation naturelle non payante : **le signaler au développeur** et lui conseiller de vérifier auprès de son conseil départemental de l'ordre.
- **Honoraires** (art. R. 4321-98, tel que remplacé par le décret) : le praticien qui présente son activité sur un site « doit y inclure une information sur les honoraires pratiqués, les modes de paiement acceptés » et les obligations d'accès aux soins sans discrimination ; information « claire, honnête, précise et non comparative ». Le plugin **n'écrit aucun montant** : si l'information manque, il la signale comme mention à fournir par le praticien.
- **Spécificités, titres, diplômes** (S2, annexe 2 et annexe 4) : seules les spécificités d'exercice reconnues par le Conseil national (avis n° 2021-002) peuvent être affichées ; « toute référence à une marque, méthode ou concept ne relève pas des spécificités d'exercice » ; aucune mention d'une technique ou méthode « insuffisamment éprouvée ». Le plugin ne rédige une spécificité, un titre ou un diplôme **que si le projet l'affiche déjà**, à l'identique.
- **Mentions du site** (S2, annexe 4) : S2 liste des mentions obligatoires (identité, adresse, téléphone, messagerie, numéros d'inscription à l'ordre et RPPS, honoraires et modes de paiement, mentions légales). Le plugin ne les invente pas ; il signale celles qu'il ne trouve pas.
- **Informations médicales et liens** (S2, annexe 4) : informations à « caractère objectif » et à « finalité scientifique, préventive ou pédagogique », sources précisées et datées ; liens commerciaux interdits. S2 recommande des sources certifiées par une fondation désignée par la Haute Autorité de santé : **à vérifier** que ce dispositif est toujours en vigueur avant de s'y référer.
- **Témoignages** : interdits par R. 4321-67-1 ; S2 (principe n° 5) demande aussi de respecter l'anonymat des patients.

### 2.2 Médecins (source vérifiée, article seul)

Source : page du Conseil national de l'ordre des médecins (CNOM) consacrée à l'article 19-1 du code de déontologie médicale (art. R. 4127-19-1 du code de la santé publique) et à son commentaire (§ 5, S3).

- **Article R. 4127-19-1** (texte reproduit par S3) : même structure que pour les masseurs-kinésithérapeutes : liberté de communiquer « par tout moyen, y compris sur un site internet » ; communication « loyale et honnête », qui « ne fait pas appel à des témoignages de tiers », « ne repose pas sur des comparaisons avec d'autres médecins ou établissements », « n'incite pas à un recours inutile à des actes de prévention ou de soins » ; informations de santé « scientifiquement étayées », formulées « avec prudence et mesure » ; prise en compte des recommandations du conseil national.
- **Commentaire du CNOM** (S3), recommandations à suivre : ne pas afficher de notations, évaluations, commentaires, remerciements ou témoignages de patients ou de tiers ; pas de comparatifs de délais, de tarifs ou d'actes ; « s'interdire toute forme de procédé destiné à obtenir un référencement numérique prioritaire » (l'usage de hashtags pour gagner en visibilité y est assimilé) ; ne pas mentionner de diplômes non reconnus pour l'exercice en France ni de titres non autorisés par le conseil national ; pas de photo avant/après suggérant un résultat.
- **À vérifier** : S3 renvoie à l'article R. 4127-80 pour l'interdiction d'obtenir un référencement prioritaire ; son texte n'a pas été consulté directement. Vérifier sur Légifrance la version en vigueur.

### 2.3 Infirmiers (à vérifier)

Aucune source officielle n'a pu être consultée. Une source secondaire (assureur professionnel, § 5, S4) indique : décret n° 2020-1660 du 22 décembre 2020 ; communication au public régie par l'art. R. 4312-68-1 (loyale et honnête, sans témoignages de tiers ni comparaisons) ; référencement numérique prioritaire interdit (art. R. 4312-69 selon S4) ; information sur les honoraires sur le site (art. R. 4312-80 selon S4).
**À vérifier** sur Légifrance : texte en vigueur de ces articles et numéro du décret ; recommandations de l'ordre national des infirmiers. En attendant : partie générique, et aucune règle propre aux infirmiers présentée comme certaine.

### 2.4 Autres professions de santé (à vérifier)

Selon une source secondaire (S5), la même série de décrets du 22 décembre 2020 a modifié la communication des chirurgiens-dentistes, sages-femmes et pédicures-podologues, en plus des médecins, infirmiers et masseurs-kinésithérapeutes. Aucun de ces textes n'a été consulté ici. **À vérifier** : code de déontologie de la profession (code de la santé publique, sur Légifrance) et recommandations de son ordre. Pour une profession qui n'a pas d'ordre ou n'est pas citée : partie générique, et le dire.

### 2.5 Ce que `seo-contenu` en tire (pays `FR`)

- Textes **informatifs** : qui, quoi, où, comment venir ; jamais d'argument de vente, de comparaison ou de témoignage.
- Aucune spécificité, titre, diplôme, honoraire ou méthode qui ne soit **déjà affiché** par le projet.
- Signaler au développeur, dans la présentation du lot : la règle de référencement prioritaire de sa profession (si elle est vérifiée ci-dessus) ou le besoin de la vérifier ; les mentions obligatoires manquantes trouvées (honoraires, identité, numéros) ; toute phrase existante du projet qui contredit ces règles (promesse, avis, superlatif), avec proposition de reformulation.

## 3. Autres pays

Pour tout `pays` autre que `FR` : appliquer la **partie générique** (§ 1) seulement. Les règles françaises (§ 2) **ne s'appliquent pas**. Ce fichier ne dit rien du droit des autres pays : la réponse finale du skill le précise et demande au développeur de **vérifier le droit local** et les règles de l'organisme professionnel du pays (ordre, autorité de régulation) avant publication.

## 4. Types schema.org (pour `seo-donnees-structurees`)

| Type | Usage | Limites |
|---|---|---|
| `MedicalBusiness` | établissement de santé local quand aucun sous-type ne correspond | sous-type de `LocalBusiness` ; préférer un sous-type précis s'il s'applique |
| `Physiotherapy` | cabinet de kinésithérapie / physiotherapy | à la fois sous-type de `MedicalBusiness` et valeur de l'énumération `MedicalSpecialty` (S6) |
| `Physician` | médecin ou cabinet médical | sous-types `IndividualPhysician` et `PhysiciansOffice` (S7) ; seulement pour un médecin |
| `MedicalClinic` | structure de soins regroupant plusieurs praticiens | seulement si le projet présente une structure de ce type |
| `Dentist` | cabinet dentaire | seulement pour un chirurgien-dentiste |

Limites communes :

- Le type choisi correspond à la **profession réelle** affichée par le projet ; ne pas employer `Physician` pour une profession paramédicale.
- `medicalSpecialty` : seulement une valeur de l'énumération `MedicalSpecialty` de schema.org qui correspond à ce que le projet affiche ; jamais une spécialité déduite ni, en France, une spécificité non affichée (§ 2.1).
- Ni `AggregateRating`, ni `Review` : en plus de la règle générale du plugin, les témoignages sont exclus par la partie générique et, en France, par les textes du § 2.
- Ni prix, ni `hasCredential`, ni affiliation non affichés par le projet.
- Pas de `FAQPage` portant des conseils de santé qui ne figurent pas sur la page.

## 5. Sources

Consultées le **2026-11-25**.

| Id | Source | Émetteur, nature | Profession | URL |
|---|---|---|---|---|
| S1 | Décret n° 2020-1663 du 22 décembre 2020 portant modification du code de déontologie des masseurs-kinésithérapeutes et relatif notamment à leur communication professionnelle, JORF du 24 décembre 2020 | Journal officiel (fac-similé hébergé par un conseil départemental de l'ordre des masseurs-kinésithérapeutes) | masseurs-kinésithérapeutes | https://ain.ordremk.fr/files/2021/02/DECRET-22-12-2020-Modifiant-le-code-de-deontologie-des-mk.pdf |
| S2 | Recommandations relatives à la communication du masseur-kinésithérapeute, adoptées le 30 mars 2021, 2e édition consolidée à l'issue du Conseil national du 15 décembre 2022 | CNOMK (document hébergé par un conseil régional de l'ordre) | masseurs-kinésithérapeutes | https://auvergnerhonealpes.ordremk.fr/files/2023/09/La-communication-du-MK.pdf |
| S3 | Code de déontologie médicale, article 19-1 « Communication professionnelle » et commentaires | CNOM | médecins | https://conseil-national.medecin.fr/code-deontologie/devoirs-generaux-medecins-art-2-31/article-19-1-communication-professionnelle |
| S4 | « La communication de l'infirmier au public et aux autres professionnels » | MACSF, **source secondaire** (assureur) | infirmiers | https://www.macsf.fr/responsabilite-professionnelle/relation-au-patient-et-deontologie/communication-professionnelle-infirmiers |
| S5 | « Publicité et information du public : la donne change pour les médecins » | La Revue du Praticien, **source secondaire** | plusieurs professions | https://www.larevuedupraticien.fr/article/publicite-et-information-du-public-la-donne-change-pour-les-medecins |
| S6 | Type `Physiotherapy` | schema.org | — | https://schema.org/Physiotherapy |
| S7 | Type `Physician` | schema.org | — | https://schema.org/Physician |

Texte consolidé en vigueur : Légifrance, https://www.legifrance.gouv.fr (non consulté article par article ici : les citations de S1 sont celles du décret de 2020, à recontrôler sur la version consolidée).
