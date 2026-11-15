# Protocole partagé 0.3 — distinct de l’intégration Windows

## Autorité et isolation

Un déploiement et une base sont dédiés à une seule exploitation, Ty Bufala. Aucun accès à Zantho. Le rôle et l’auteur sont issus de la session authentifiée, jamais du contenu saisi. L’identifiant d’appareil sert à la traçabilité et ne donne aucun droit.

## Opération

`POST /api/sync` reçoit `operations`, une liste de 1 à 100 opérations :

```json
{"opId":"op_UUID","deviceId":"device_UUID","kind":"animals","baseRevision":0,"data":{"id":"animal_UUID","earTag":"IDENTIFIANT","sex":"","status":"present"}}
```

- `opId` est immuable pendant les réessais ; `data.id` identifie la fiche, l’événement ou la vente pendant toute sa vie.
- `kind` vaut `animals`, `events` ou `sales`.
- `baseRevision=0` crée une entité ; toute correction fournit la version serveur attendue.
- L’auteur, la révision, l’heure serveur et l’état d’intégration Windows ne sont pas laissés au choix du client.
- Les numéros d’identification sont normalisés en majuscules sans espaces. Les anciens numéros corrigés restent réservés à la même fiche. Une autre fiche ne peut pas les réutiliser silencieusement.

## Transaction et reçu

Le groupe entier est validé dans une transaction : fiches, versions, appareils, journal, empreintes et reçus. Si un membre échoue, aucun nouveau membre n’est intégré. Les réessais de membres déjà acquittés retournent leur reçu enregistré.

La réponse `receipts` contient pour chaque opération `opId`, `kind`, `id`, `revision`, `seq` et `data`. Un identifiant réutilisé avec un contenu ou un auteur différent est refusé. La date du téléphone ne départage jamais deux écritures concurrentes.

Un conflit répond HTTP 409 avec `code=revision_conflict`, l’opération et la version commune. Une validation métier refusée répond 422 ; un rôle insuffisant 403. Le téléphone conserve les opérations non acquittées. Les choix de résolution sont explicitement confirmés et archivés localement ; une nouvelle concurrence peut à nouveau bloquer une reprise.

## Lecture incrémentale et historique

`GET /api/changes?after=N` retourne les changements ordonnés, `cursor` et `hasMore`. Le curseur est la dernière séquence effectivement renvoyée, jamais une séquence non lue. Les écrivains sont sérialisés par verrou SQL pour éviter de dépasser une transaction non encore validée.

Le téléphone applique les données et le curseur dans une transaction IndexedDB ; il ne remplace pas les fiches ayant une modification locale en attente. `GET /api/record/{kind}/{id}` et `/api/history/{kind}/{id}` servent à la comparaison et à l’historique. Aucun effacement silencieux ; sorties, annulations et corrections restent tracées.

## Hors connexion et utilisateurs

Une base IndexedDB séparée est utilisée par compte. Chaque sauvegarde locale enregistre atomiquement les fiches et le groupe d’opérations. Les onglets se coordonnent par Web Locks. La première ouverture nécessite une connexion ; les prochaines ouvertures hors ligne peuvent utiliser le profil précédemment autorisé sur l’appareil. Les tentatives réseau exigent toujours une session valide côté serveur. La déconnexion attend la résolution/transmission des saisies, puis efface la copie de ce compte.

## Source Excel et sauvegardes

L’import initial est réservé à la console administrative, sur base vide et après validation de la source. Une empreinte SHA-256 empêche de réimporter la même source. Une version différente sur base déjà peuplée nécessite un rapprochement à développer ; aucun écrasement n’est autorisé.

Le classeur complet est archivé en privé, avec les valeurs et formules source des fiches, les événements historiques et le rapport des lignes non identifiées. Les dates inconnues restent inconnues. Une prévision de vêlage garde une provenance non confirmée et ne devient pas une gestation.

`/api/export` est une sauvegarde centrale, complète pour l’administrateur. Les comptes et secrets ne font pas partie de la sauvegarde métier. La restauration sur base vide rétablit aussi les reçus et le journal, donc les anciens réessais restent idempotents. Le job Graph optionnel vérifie les fichiers distants avant d’enregistrer un reçu de sauvegarde. Il n’est ni activé ni assimilé à une projection Excel réussie.

## Ventes et Windows : verrou métier maintenu

Une ligne utilise `quantityMilli`, `unitPriceCents`, `totalCents` entiers. Le TTC de ligne vaut `(quantité × prix + 500) // 1000`. La vente est la somme des lignes. Avec un taux connu, le HT est arrondi par ligne et la TVA vaut TTC − HT ; avec un taux inconnu, HT et TVA restent inconnus.

Le reçu de la base commune confirme seulement le partage mobile. `syncState=pending` reste en attente de Windows. **Aucun endpoint ne permet au mobile de déclarer une vente intégrée dans SQLite.** Les identifiants mobiles ne sont ni des commandes ni des factures Windows.

L’adaptateur comptable définitif doit, après examen du vrai code et du schéma SQLite : mapper le catalogue, appliquer création/correction/annulation dans une transaction Windows, enregistrer une clé unique `(source, sale_id, revision)` et n’émettre un reçu qu’après COMMIT. Un échec doit conserver la vente à corriger ou à transmettre. Cette partie n’est pas implémentée et aucun accusé n’est simulé.

## Reprise du prototype PR n° 1

| Référence PR 1 | API persistante |
|---|---|
| `entity`, `entityId` | `kind`, `data.id` |
| `_serverRevision`, `serverRevision` | `revision` |
| `sequence` | `seq` / `cursor` |
| `actorId` passé par appelant | utilisateur issu de la session serveur |
| `deviceId` | identifiant stable du cache de l’appareil |
| reçu en mémoire | empreinte et reçu durables SQL |
| traitement par opération du prototype | groupe atomique SQL |

Le module en mémoire n’est pas chargé dans l’application. Les garanties du contrat sont testées contre le serveur réel local et sa persistance, puis devront être confirmées sur PostgreSQL avant les données réelles.


## Variante Render + OneDrive (expérimentale, désactivée)

Le budget est fixé à 0 €. `RENDER_ONEDRIVE.md` décrit une variante avec journal
SQL immuable et génération distante unique. Aucun reçu n'est envoyé avant
publication et relecture distante ; un échec conserve la file du téléphone.
Les tests locaux ne prouvent pas l'atomicité de Microsoft Graph. Autorisation
Microsoft, renouvellement OAuth, essais réels, performance et restauration
restent nécessaires avant activation. Aucune base réelle n'y est déposée.

Les identifiants d'entité issus de la base de référence peuvent contenir `:`.
Ils restent stables et sont encodés dans les URL ; les clés composées du cache
sont séparées au premier `:` uniquement. Les identifiants d'opération d'import
sont des empreintes stables distinctes des identifiants d'entité.

L'import de référence est atomique sur une destination vide, réexécutable sans
doublon et conserve la base source entière en archive privée. Les noms de
parents rapprochés mais non confirmés alimentent `motherCandidateTag` ou
`fatherCandidateTag`, sans créer de lien confirmé `motherTag`/`fatherTag`.


## Export vers le sas Windows

`GET /api/windows-staging` est réservé à l'administrateur. Le format
`windows-staging` v1 contient uniquement les ventes (`salesComplete: true`),
avec leurs identifiants et révisions ; `windowsIntegrated: false` distingue
explicitement cet export d'un accusé comptable. Le sas repris dans
`tools/windows_staging.py` accepte ce format et l'ancien `central-backup` v2.
Un éditeur ne peut pas déclencher cet export ; les données ne sont pas mises
en cache par HTTP. Le cheptel et les archives restent exclus du nouveau format.
L'import dans les tables commerciales Windows et le retour des vrais reçus
ne sont toujours pas activés.
