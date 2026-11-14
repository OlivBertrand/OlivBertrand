# Contrat de reprise Ty Bufala Mobile -> Ty Bufala Windows (préparation)

Le fichier exporté « pour Ty Bufala » est une enveloppe JSON UTF-8 avec :

- `application`: `ty-bufala-mobile`
- `formatVersion`: `1`
- `kind`: `ty-bufala-import`
- `exportedAt`: ISO 8601
- `source`: `mobile`
- `animals`: fiches complètes (id, earTag, name, sex, birthDate, motherTag, status, notes, createdAt, updatedAt)
- `events`: événements (id, animalId, type, date, description, nextDate, timestamps)
- `sales`: ventes non acquittées (id, date, channel, paymentMethod, client, notes, lines, cancelled, syncState, timestamps)

Chaque ligne de vente comporte `product`, `quantityMilli` (quantité en milli-unités), `unit`, `unitPriceCents` (TTC), `totalCents` (TTC arrondi au centime pour la ligne), `vatRate` (null ou pourcentage). Le total de vente est la somme des lignes, jamais recalculé par un flottant.

Points obligatoires avant toute écriture en base Windows :

1. Connaître les schémas réels du module Cheptel et du module Ventes marché/ventes ponctuelles ainsi que les noms de produits et codes TVA dans la version active.
2. Valider les mappings métier (n° d'identification de l'animal, unité, désignation produit, atelier et TVA). Ne pas deviner les correspondances.
3. Réception idempotente par `source + id`, mise à jour conditionnée par `updatedAt`, gestion des annulations et traçabilité; accusé de réception avec les ID et versions acceptées/refusées.
4. Prévoir les deux sens pour les fiches de cheptel si elles sont également modifiées sur Windows, avec gestion explicite des conflits.
5. Authentification des appareils, HTTPS de bout en bout et stockage durable. Ne jamais mettre les données privées dans le dépôt GitHub public ni dans un stockage éphémère Render.
6. Tests sur une copie de `ty_bufala.db` avant la production, pas de migration non validée.

La V0.1 **ne réalise pas** ces opérations : export manuel uniquement. Ce document ne constitue pas une interface intégrée fonctionnelle.

## Données cheptel version 0.2

Animal : `id`, `earTag` (n° national canonique), `workNumber`, `name`, `sex`, `birthDate`, `motherTag`, `motherName`, `fatherName`, `status`, `lastCalving`, `matingDate`, `expectedCalving`, `weaningDate`, `introducedAt`, `exitDate`, `exitReason`, `notes`, `source`, `sourceRow`, `createdAt`, `updatedAt`. Les champs omis sont optionnels. Le champ `expectedCalving` est une prévision non médicale, potentiellement périmée et à valider.

Les enfants sont reliés à leur mère par le `motherTag`; les dates de sortie historiques restent dans les fiches (pas de suppression). Un export `kind=initial-inventory` est accepté à l'import, comme `kind=backup`, mais n'a aucune valeur d'accusé de réception OneDrive ou PC.

La source de référence du cheptel doit être choisie avant activation de toute synchronisation bidirectionnelle. La stratégie recommandée est serveur/API authentifiée avec journal de modifications, identifiants stables, conflits manuels, import PC transactionnel, et sauvegarde avant fusion. **Ne pas copier un fichier Excel vers OneDrive en arrière-plan sans authentification et verrouillage de concurrence.**
