# Chantier complémentaire — intégrité cheptel et ventes (à intégrer par Work)

## Statut

Cette branche **ne touche pas la production** et ne contient **aucune donnée d'élevage**. Elle ajoute un onglet « Contrôles » (lancé localement dans la PWA existante), des vérifications d'import et une spécification exécutable de synchronisation. Elle **ne fournit pas encore d'API commune, d'authentification, d'accès OneDrive ou d'import SQLite réel**.

## Fichiers

- `quality.js` : validation des animaux, contrôle des dates, liens de filiation, prévisions à confirmer, erreurs de montant TTC.
- `enhancements.js` + `enhancements.css` : vue « Contrôles » et exploration de la descendance de plusieurs générations; arrêt des imports entraînant des collisions de numéros de boucle.
- `sync-core.js` : algorithme **de référence** pour idempotence des ventes et des événements, versions serveur, conflits de concurrence et extraction incrémentale. **Ne pas utiliser comme serveur en mémoire en production** : adapter dans une transaction SQL sur base durable.
- `tests/*.test.cjs` : cas synthétiques (sans données privées) validant 13 scénarios.
- `index.html` : charge les modules et expose l'onglet « Contrôles ».
- `sw.js` : précache les nouveaux scripts et invalide le cache ancien.

## Vérification sur le fichier réel (local seulement, sans diffusion des fiches)

Sur `Inventaire_Ty_Bufala_import_mobile.json` préparé à partir du tableur privé :
- 90 fiches, 60 sans sortie, 30 sorties ;
- 0 erreur bloquante selon les règles déterministes actuelles ;
- 6 prévisions de vêlage dépassées mais non confirmées ;
- 11 filiations maternelles sans correspondance dans les 90 fiches (cela peut être normal si les mères sont extérieures au fichier).

Cette analyse ne vaut pas certification de l'inventaire ni rapprochement avec OneDrive live. Les alertes sont **des demandes de vérification**, pas des décisions vétérinaires.

## Intégration Work / Codex demandée

1. **Avant déploiement public**, valider les modifications de cette PR et les fusionner/réimplémenter dans la branche Work. Ne pas modifier `main` simultanément depuis deux sessions.
2. Créer une base Postgres durable et isolée, avec utilisateurs, rôles, appareils, `animals`, `events`, `sales`, `operations`, `receipts`, `revisions`, `conflicts`, `projections` et **sauvegardes**. Index unique sur le numéro national canonique dans le périmètre de l'exploitation.
3. Authentifier chaque requête au serveur (ne jamais accepter `actorId` envoyé librement depuis le navigateur). Ne jamais placer la clé Microsoft Graph dans le JavaScript public. Utiliser un endpoint backend à autorisation contrôlée.
4. Insérer l'entité, sa révision, l'identifiant de l'opération, le reçu idempotent et le journal de synchronisation **dans une transaction SQL unique**. Unique par `(tenant_id, op_id)`. Un `op_id` rejoué avec payload différent est rejeté. Ne pas déduire la réussite d'un export JSON.
5. L'application mobile maintient une **outbox IndexedDB** locale : opérations UUID durables, `baseRevision`, `deviceId`, tentative de réexpédition et `ack` du serveur avec la révision validée; ne pas supprimer les opérations non acquittées. Les conflits deviennent des éléments à arbitrer, pas des remplacements « dernier horodatage gagne ».
6. Synchronisation OneDrive Excel : **projection** et import contrôlé ; si Excel reste éditable par d'autres, importer les modifications avec comparaisons (ETag/version Graph) et journal, détecter conflits. Éviter d'écraser un classeur entier sans contrôle de concurrence. Préserver les formules historiques. Ne jamais publier Excel ni le JSON initial sur GitHub/Render static.
7. Ty Bufala Windows : déterminer le schéma réel (DEV-isole) des produits, ventes marchés, règlements, annulations, TVA, puis implémenter le traitement transactionnel des ventes réelles avec l'identifiant mobile comme clé idempotente. Aucun passage en production sans tests sur copie.
8. Tester trois utilisateurs, deux appareils hors ligne modifiant la même fiche, une vente retransmise 20 fois, une annulation, un défaut réseau à mi-import, un retour arrière de transaction, une sortie puis réentrée d'animal, et la reprise d'un appareil neuf.

## Commande de test

```sh
node --test tests/*.test.cjs
```

## Attention technique

`sync-core.js` est une **maquette de contrat exécutable**, non le connecteur réel. Le serveur final doit gérer les comptes, autorisations, scoping tenant, persistance ACID, le temps serveur, le chiffrement, les sauvegardes, la conformité et les erreurs réseau.

L'utilisateur a explicitement confié à Work l'architecture globale. Toute divergence entre l'architecture retenue par Work et cette branche doit être traitée en revue, pas fusionnée automatiquement.