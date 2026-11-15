# Ty Bufala Mobile — chantier DB / migration de l'inventaire (2026-11-14)

## État constaté

Le premier import JSON mobile de la conversation n'était **pas exhaustif** : 90 animaux. Le classeur Excel original contient **98 identifiants animaux uniques**, dont **8 mâles sans nom** (non repris dans le JSON), ainsi que trois onglets : `Inventaire`, `Descendance`, `Événements`.

Le fichier de référence privé **`Ty_Bufala_inventaire_reference_v1.db`** a été régénéré à partir du `.xlsx` original et a été conservé en dehors du dépôt GitHub public. Ne jamais le déposer sur un CDN public ou dans les assets statiques de Render.

## Livrables de code (sans données privées)

- `db/schema_v1.sql` : schéma SQLite relationnel, clé nationale unique, parenté, événements datés/non datés, traitements, pièces jointes, mouvements historiques, ventes TTC au centime, journal de sync et audit.
- `db/migrate_inventory.py` : conversion reproductible et **non destructive**, lecture des 3 onglets, extraction des cellules/formules/caches, copie originale exacte du classeur dans `source_archives`, import des 98 animaux, généalogie à statut de résolution explicite, 4 événements historiques de l'onglet `Événements`, mouvements datés, remarques globales, descendants calculés conservés comme références (pas de faux animaux créés), protection contre les doublons.
- `db/README.md` : utilisation et architecture.
- `tests/test_db_migration.py` : tests uniquement sur données fictives (ordre des feuilles inversé, dates sans preuve, collisions, idempotence, argent en centimes, original inchangé).

## Contrôles sur le fichier réel (14/11/2026)

| Table / donnée | Résultat |
|---|---:|
| Animaux | 98 |
| Sans sortie inscrite | 63 |
| Avec sortie historique | 35 |
| Animaux sans nom conservés | 8 |
| Liens mère/père conservés | 175 |
| Événements structurés/importés | 86 (47 introductions, 35 sorties, 4 événements spécifiques) |
| Lignes de descendance historique | 48 (88 références de descendants dans le tableau) |
| Notes générales de l'onglet Événements | 10 |
| Lignes anonymes / placeholders conservées pour contrôle | 6 |
| Cellules Excel non vides ou comportant une formule | 11 371 |
| Formules Excel référencées | 9 454 |
| Contrôle intégrité SQLite | `ok` |
| Contrôle clés étrangères | 0 erreur |
| Sauvegarde exacte du fichier Excel dans `.db` | SHA-256 vérifié |

Les 90 identifiants du JSON précédent sont tous présents dans la nouvelle DB. Les seuls écarts des champs métier comparés se trouvent dans les notes historiques qui avaient été concaténées au texte dans le précédent import et sont désormais stockées correctement comme événements.

Les relations de parenté issues du seul nom sont **des rapprochements non confirmés**, jamais une certitude. 80 références maternelles et 51 paternelles ont un rapprochement par nom unique ; 14 maternelles et 30 paternelles restent sans parent identifié dans la base. Cela ne signifie pas que les animaux sont dépourvus de parent, seulement que le classeur ne permet pas une identification certaine.

Six prévisions de vêlage de femelles indiquées présentes sont antérieures au 14/11/2026 et ne peuvent pas être considérées comme des vêlages réalisés. Trois événements `Mort-né / décès` n'ont pas de date source : les dates restent NULL et aucune date artificielle n'est créée.

## Coordination avec la branche Work déjà ouverte

La branche GitHub `work/ty-bufala-mobile-shared` contient déjà `server/inventory.py` et `server/store.py`, dont une logique de stockage PostgreSQL et d'import XLSX. **Ne pas écraser ce code, ni lancer les deux importateurs sur la même base.**

Le serveur Work utilise actuellement un ID `animal_<uuid5(...)>` alors que la base portable conserve `animal_FR...` pour compatibilité avec le JSON mobile précédent. **La clé commune pour réconcilier est le numéro national canonique (`national_id` / `earTag`), pas l'ID technique.** Introduire des alias/identifiants externes si nécessaire, sans dupliquer les animaux et sans perdre la révision serveur existante.

Cette base portable est complémentaire : elle prouve la migration des 98 animaux et apporte des tables relationnelles, les données brutes des 3 feuilles, une archive exacte et des contrôles. Work peut préférer son importateur XLSX pour le backend tout en exploitant ces tests et la base comme référence.

## Demande à ChatGPT Work

1. Garder le .xlsx comme **archive et support d'échanges**, pas comme base opérationnelle modifiée simultanément.
2. Construire une **base centrale PostgreSQL sécurisée** pour au moins trois comptes, avec application Android PWA locale IndexedDB + file d'attente offline, API HTTPS, droits et sauvegardes.
3. Importer **transactionnellement** la `.db` privée avec les identifiants `animal_FR…` / `national_id` stables et le `source_files.sha256`. Si la base centrale est déjà peuplée, fusionner sans doublon et sans écraser les changements plus récents ; proposer une résolution de conflits.
4. Maintenir la séparation parent identifié / filiation supposée par nom / parent extérieur, et préserver les données brutes.
5. Mettre en œuvre l'aller-retour OneDrive : exporter la projection de l'inventaire vers le classeur sous contrôle de version (ETag), sans écraser les formules ni les modifications humaines. Le schéma central est la référence pour les ajouts de l'application.
6. Développer la passerelle vers le vrai schéma de `ty_bufala.db` après audit du logiciel Windows ; pour les ventes, source+UUID, mapping produits et TVA réels, écritures transactionnelles et accusés de réception durables.
7. Ne pas annoncer que la PWA est synchronisée tant que les tests **trois comptes**, **hors ligne**, **réconciliation** et **rejeu des ventes** ne sont pas passés.
8. **Ne pas déployer** la DB privée sur le service Render statique. Provisionnement de PostgreSQL : consentement préalable en cas de coût.

### Point de coordination

Cette branche ne modifie pas l'application publique ni les services Render. Work peut reprendre les scripts de migration sans toucher à ses fichiers API/UX. Le fichier réel `.db` doit être transféré en privé à Work ou importé par son environnement sécurisé ; seules les sources sans données réelles sont sur GitHub.