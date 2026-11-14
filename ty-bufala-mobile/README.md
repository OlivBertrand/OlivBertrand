# Ty Bufala Mobile — V0.2 (Suzanna)

Application Android installable de type PWA : un site HTTPS qui fonctionne aussi hors connexion après une première ouverture en ligne. Application créée séparément de Zantho. Le code hébergé sur GitHub/Render ne contient **aucune donnée de cheptel**.

## Fonctions disponibles

- Cheptel : identité/nom/n° de travail, naissance, sexe, filiation mère-père, recherche et filtres (présents, sortis, femelles, mâles, moins de 2 ans), dates de vêlage, de reproduction, de sevrage, de sortie, notes et historique d'événements.
- Descendance : les enfants renseignés avec le numéro national de la mère sont reliés directement à sa fiche, avec navigation vers la fiche de chaque descendant.
- Événements : nouvelle observation, vêlage, soin, traitement et rappel libre. Lorsqu'un nouveau veau est créé avec une mère existante, sa date de naissance actualise la date du dernier vêlage de la mère, sans la dater à l'avance ; même logique pour un événement « Vêlage » explicite.
- Alertes : rappels personnalisés à 30 jours. Les échéances de vêlage issues de l'Excel sont **explicitement présentées comme « prévision à confirmer »**, même lorsqu'elles sont dépassées. Ne jamais confondre avec un diagnostic de gestation.
- Ventes ponctuelles : plusieurs produits, quantité, unités, prix TTC, date, client, canal et moyen de paiement, total recalculé au centime, correction/annulation traçables.
- Données : import JSON privé depuis l'inventaire Excel, import CSV générique, export JSON complet, export JSON de transmission et CSV de ventes.

## Import du cheptel initial

Le fichier privé `Inventaire_Ty_Bufala_import_mobile.json` (fourni séparément dans la conversation) a été obtenu à partir de `Inventaire bufflonnes NEW(5).xlsx` sans modifier l'original. Il contient 90 animaux, dont 60 sans sortie et 30 ayant une date de sortie, ainsi que les filiations et les métadonnées existantes. La conversion de 86 liens mère-enfant a été possible en se basant sur les noms/identifiants du tableur, 4 mères restant non identifiées dans le fichier source (« ? »).

1. Télécharger le JSON privé sur le téléphone de Suzanna.
2. Ouvrir l'application > Données > « Importer mon inventaire Ty Bufala (JSON) ».
3. Vérifier l'effectif et les prévisions ; compléter ou corriger depuis les fiches.

Les dates sont au format ISO, et les numéros nationaux sont des identifiants stables. L'import fusionne par identifiant et date de modification : si une fiche a été modifiée sur le téléphone après la conversion, elle n'est pas remplacée par le fichier initial.

## Données et synchronisation

- `IndexedDB` sur le téléphone ; utilisable hors connexion grâce au service worker. Importer n'efface pas les données déjà présentes.
- Sauvegarde à conserver dans un dossier privé OneDrive/ailleurs après chaque session, faute d'une synchronisation cloud mise en service.
- **Aucune synchronisation OneDrive automatique n'a été activée et aucun raccordement effectif à la base SQLite Windows Ty Bufala n'est fait.** Le JSON privé est une photographie de l'inventaire disponible, non une lecture live du OneDrive. Le connecteur Microsoft, le schéma SQLite et les règles de rapprochement doivent être testés avant une écriture bidirectionnelle.
- Les ventes gardent un identifiant UUID + date de modification stable, jamais validé « synchronisé » simplement parce qu'on a exporté un fichier. L'import PC devra appliquer des upserts idempotents et des accusés de réception.
- Ne jamais publier le fichier JSON privé ou des identifiants Microsoft sur le dépôt GitHub public / le Render public.

## Installation Android

Depuis l'adresse Render en HTTPS sur Chrome Android, menu ⋮ > **Ajouter à l'écran d'accueil** / **Installer l'application**. L'icône Android utilise le vrai logo aquarelle Ty Bufala fourni, avec tailles 192/512 px et image maskable.

## Vérifications prévues

- Import 90 fiches, vérification 60 présents et 30 sortis, contrôle de quelques filiations et des six prévisions dépassées.
- Saisie d'une naissance reliée à la mère, mise à jour du dernier vêlage.
- Vente de deux produits, sauvegarde locale puis export JSON/CSV.
- Rechargement hors ligne après premier chargement connecté, sauvegarde/restauration.

## Complément en revue (branche événements terrain)

Le dossier contient désormais `field-core.js`, `field-ui.js`, `field-ui.css` et `sales-math.js` (à intégrer après revue Work), afin d'assurer une saisie structurée des traitements, mouvements, réentrées et autres événements. Dates de fin de délai d'attente saisies à la main, jamais calculées. Les ventes bénéficient d'arrondis exacts, d'un avertissement sur les doublons possibles et d'un historique de corrections/annulations. La filiation paternelle est éditable ; les descendants peuvent être recherchés côté père ou mère.

Ces fonctions **n'installent pas une base commune** et ne synchronisent pas OneDrive ou SQLite automatiquement. Voir `WORK_HANDOFF_FIELD.md` pour le contrat complémentaire et les limites. Exécuter `node --test tests/*.test.cjs` avant toute fusion.