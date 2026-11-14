# Travail complémentaire pour Work — événements d'élevage et ventes

## Statut et limites

Branche dédiée `feat/tybufala-mobile-evenements-ventes`, basée sur `feat/tybufala-mobile-integrite-20261114`. Ne modifier ni l'application Render en production, ni le tableur OneDrive, ni la base SQLite Windows. Code public = **aucune donnée réelle**.

Ces ajouts fonctionnent sur la version **IndexedDB locale** existante, sans comptes et sans API. Ils ne remplacent pas le développement multiutilisateur confié à Work.

## Ce qui a été développé

- Formulaire d'événements de terrain enrichi : observation, vêlage, saillie, insémination, diagnostic, avortement, sevrage, tarissement, soins, vaccin, analyse, **traitement**, sortie, décès, entrée et autres.
- Traitement : produit, dose, unité, voie, numéro de lot, prescripteur, personne ayant administré et dates de fin d'attente lait / viande, **saisies explicitement**. Les dates manquantes ne sont jamais interprétées comme délai nul, et aucune date n'est calculée médicalement.
- Vue de vigilance des traitements sur l'accueil et la fiche animale ; attention, une date de fin passée ne constitue **pas** une autorisation de commercialisation.
- Sortie et décès mettent à jour le statut sans supprimer la fiche ; réentrée distincte rétablit « présent » tout en conservant l'événement de sortie antérieur. Vêlage réel actualise le dernier vêlage sans inventer une gestation.
- Modification d'événement : journal `history[]` conservant les précédentes versions, état `syncState:'pending'` et transaction locale IndexedDB sur l'événement et l'animal ; vérification du `updatedAt` pour éviter un écrasement entre deux onglets locaux.
- Fiches animales : père (numéro et nom d'un reproducteur extérieur) désormais modifiable ; sélection y compris des parents sortis ; descendant maternel **et** paternel sur plusieurs générations.
- Ventes : calculs TTC exacts `BigInt`, avertissement si saisie potentiellement dupliquée (sans bloquer deux ventes réellement identiques), conservation des versions antérieures à une correction ou annulation, date future refusée. **Aucune vente n'est acquittée automatiquement.**
- 30 tests unitaires déterministes (données fictives).

## Schémas à reprendre dans l'API de Work

Les événements possèdent `id` UUID, `animalId`, `type`, `date`, `description`, `nextDate`, `createdAt`, `updatedAt`, `source:'mobile'`, `syncState:'pending'` et éventuellement :

- `medication: {name, dose, doseUnit, route, batch, prescriber, administeredBy}`
- `milkWithdrawalUntil`, `meatWithdrawalUntil` — dates explicites ou vides, jamais déduites
- `movement: {reason, destination}`
- `history: [{correctedAt, previous:{...}}]` — historique non récursif pour reconstruction

La fiche animal peut porter `fatherTag`, `fatherName`, `lastCalvingEventId`, `movementEventId`. Ces deux derniers champs servent uniquement à rattacher une projection locale à son événement d'origine. Le serveur devra préférer une projection transactionnelle à partir d'un historique canonique.

La vente conserve `id` stable, `syncState:'pending'` lors de toute modification, `cancelledAt` et `history[]`; l'API Windows doit utiliser un registre durable de `(source, id)` pour garantir l'idempotence réelle.

## Revue requise avant intégration

1. Choisir le schéma canonique du serveur et intégrer ces champs **sans perte de l'Excel ni des historiques**.
2. Les garanties de non-concurrence de la V1 locale ne suffisent **pas** pour trois utilisateurs : opId, révision serveur, outbox durable, conflits, accusés de réception et authentification par utilisateur sont requis.
3. Revoir la politique d'édition/suppression de mouvements et la réentrée. Les transitions sont volontairement prudentes : changer le type d'un événement projeté est bloqué ; ne pas imaginer que le dernier horodatage wins.
4. Les délais d'attente ne sont pas du conseil vétérinaire. Faire vérifier les libellés et règles métier avant utilisation opérationnelle dans l'exploitation.
5. Catalogues produits, unités, tarif, caisse, Bleez et TVA sont à rapprocher du **vrai code Windows** ; ne pas inférer les taux des produits.
6. Tests Node : `node --test ty-bufala-mobile/tests/*.test.cjs`; tests de navigateur complets et de 3 appareils doivent encore être exécutés dans l'environnement Work. Une restriction de politique Chromium empêche le test E2E ici.

**Ne pas déployer automatiquement cette branche.** Cherry-pick ou adapter seulement après revue Work.

## Contrôle complémentaire

- Un import CSV partiel est maintenant construit à partir de la fiche existante (`...existing`) pour conserver les champs que le CSV ne mentionne pas ; son application reste locale et exige la même vérification des conflits d'identification.
- Modifier un ancien mouvement ne re-projette plus le statut de l'animal si un événement de mouvement plus récent est devenu la projection courante.
- L'exécution Chrome E2E a été essayée, mais la politique de navigateur du conteneur (`URLBlocklist: ["*"]`) refuse les pages locales. Les tests Node passent mais les tests fonctionnels en navigateur restent à réaliser dans Work.