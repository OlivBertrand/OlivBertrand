# Ty Bufala Mobile — branche de développement 0.3

PWA Android/ordinateur avec API authentifiée et base commune. Cette branche ne remplace pas la production statique existante. Aucune donnée d’élevage ni aucun secret n’est inclus dans le dépôt.

## Réalisé

- API Flask, PostgreSQL pour l’hébergement durable, SQLite uniquement pour les essais locaux. Le serveur refuse SQLite sur Render.
- Comptes individuels créés depuis la console privée, rôles administrateur/éditeur/lecture. Sessions en cookies HTTPS HttpOnly/SameSite, contrôle CSRF, limitation des tentatives de connexion, auteur déterminé côté serveur.
- Révisions, identifiants d’opération et d’appareil, reçus et journal enregistrés dans une transaction SQL. Un groupe naissance/mère est atomique. Une collision de version bloque la modification.
- Copie IndexedDB par compte, file d’attente durable, réessais avec le même identifiant après une réponse perdue, chargement incrémental sur un appareil neuf. Aucun import récurrent à effectuer sur les téléphones après l’import central.
- Résolution explicite d’un conflit ; la version locale abandonnée et ses groupes dépendants sont archivés dans le journal local, exportable avec la file d’attente.
- Cheptel, événements et traitements structurés, filiations maternelles et paternelles, descendance sur plusieurs générations, contrôles du cheptel issus de la PR n° 1 et adaptés à l’architecture commune.
- Prix et quantités entiers, calcul TTC exact ; HT/TVA calculés si taux connu, laissés inconnus sinon. Une vente partagée ne reçoit jamais un faux accusé d’intégration Windows.
- Extraction Excel en lecture seule. Original complet archivé en privé dans la base ; formules et cellules source préservées. Identifications incertaines conservées pour examen. Événements non datés explicitement conservés comme tels.
- Sauvegarde cohérente avec journal et reçus ; restauration contrôlée sur destination vide uniquement.

## Mise en service restant à valider

1. Budget fixé à **0 €**, avec Render conservé. La base PostgreSQL gratuite Render expire et ne convient pas aux données réelles. Une variante expérimentale Render + journal OneDrive est développée mais désactivée : voir `RENDER_ONEDRIVE.md` pour les essais et limites bloquantes. Aucune offre payante à souscrire.
2. Valider le stockage choisi, sa restauration et le raccordement OneDrive avant l’import réel. L’importeur `server.reference_import` lit la base de référence SQLite en lecture seule : 98 animaux et 86 événements ont été importés en test privé local, original intact, réimport sans doublon. Les liens non confirmés restent des propositions.
3. Valider les comptes et droits avant leur ouverture. Les tests utilisent uniquement des comptes synthétiques locaux.
4. Microsoft Graph : `server/onedrive.py` sait télécharger une source avec contrôle ETag et déposer une sauvegarde complète dans un dossier privé, avec relecture et contrôle du SHA-256. L’authentification Microsoft et la planification ne sont pas configurées. **Ce job n’est pas une projection bidirectionnelle de l’Excel.** Il ne réécrit jamais le classeur original.
5. Examiner le vrai code Windows et une copie cohérente de `ty_bufala.db`. Aucun import comptable Windows n’est activé. Le catalogue, les unités et les règles de TVA doivent être rapprochés avant développement de l’adaptateur définitif.
6. Vérifier visuellement dans un vrai navigateur/mobile. Les essais IndexedDB automatisés ne constituent pas une validation du rendu.

Les photos/documents joints, la projection Excel modifiable en deux sens et le raccordement comptable Windows ne sont pas implémentés dans cette version.

## Développement local

Depuis `ty-bufala-mobile/` :

```sh
python3 -m pip install -r server/requirements.txt pytest
npm ci
export DATABASE_URL=/chemin/prive/developpement.db
python3 -m server.admin create-user administrateur --name Administrateur --role admin
python3 -m server.inventory /chemin/prive/inventaire.xlsx --report /chemin/prive/analyse.json
# Après validation et sur base vide uniquement : ajouter --apply --actor administrateur
```

Le service de production se lance avec Gunicorn, dans ce dossier :

```sh
gunicorn 'server.app:create_app()' --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 60
```

Sur Render, définir `DATABASE_URL` via les secrets du service et `APP_ORIGIN` avec l’origine HTTPS exacte. Sans base configurée, toutes les API privées répondent 503. La page publique ne contient pas l’inventaire.

Ne pas fusionner cette branche vers le site statique actuel avant de préparer le changement d’hébergement : un site statique ne peut pas exécuter le serveur Python.

## Vérifications

```sh
python3 -m pytest -q
node --test tests/quality.test.cjs
npm run test:sync
```

Le dernier test démarre un serveur local jetable, deux stockages IndexedDB indépendants et trois comptes synthétiques. Il vérifie reprise hors ligne, partage, concurrence, résolution, réponse perdue et droits en lecture seule.

`tools/windows_probe.py` peut extraire le schéma d’une copie SQLite fermée et cohérente en lecture seule, sans exporter les lignes métier. Il faut fournir aussi les modules Python concernés pour examiner les règles réelles.

Voir `SYNC_CONTRACT.md` et `PR1_INTEGRATION.md` pour les détails de protocole et la reprise de la PR complémentaire.
