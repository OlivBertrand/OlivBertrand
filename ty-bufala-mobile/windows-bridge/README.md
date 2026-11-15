# Ty Bufala Windows — sas de ventes centralisées

Outil **isolé** de préparation et de contrôle des ventes Ty Bufala Mobile pour le futur connecteur Windows. Compatible avec une sauvegarde **administrateur complète** `central-backup`, `formatVersion: 2`, `complete: true` de la branche Work `work/ty-bufala-mobile-shared`, créée par `server.backup.snapshot`. Aucune donnée réelle dans le dépôt.

## Pourquoi un sas ?

- Une vente possède un `sale_id` stable, plusieurs versions (`revision`) et un hash de contenu immuable.
- Un nouvel export du serveur peut contenir la même vente : le sas ne la crée qu'une fois.
- Une correction avant intégration rend l'ancienne version `superseded`.
- Une correction / annulation **après** intégration est conservée avec état `requires_review` ; elle n'est jamais comptée silencieusement comme une nouvelle vente.
- Une annulation avant intégration devient `ignored_cancelled`.
- Un accusé réel exige un marqueur **durable de la base Windows**, et non un clic sur un bouton ou un simple export.

## Commandes (PC, hors base de production)

Exécuter depuis ce dossier :

```sh
python staging.py --ledger D:/TyBufala/prive/mobile-staging.db stage D:/TyBufala/prive/snapshot-mobile.json
python staging.py --ledger D:/TyBufala/prive/mobile-staging.db status
```

Le fichier de sauvegarde peut contenir noms de clients, données de vente et autres données de l'exploitation. Il reste **privé et chiffré si transporté**. La base de sas est privée et doit être sauvegardée avec la base Windows ; ne pas la placer dans un dossier synchronisé en écriture simultanée par plusieurs appareils.

## IMPORTANT — Aucune écriture Windows en production

Ce composant ne connaît pas encore les vrais schémas Ty Bufala Windows et ne crée ni ligne de caisse, ni commande, ni facture. Il n'annonce pas la vente `synced` au mobile. Le `record_verified_windows_commit` n'accepte une confirmation que si `marker_lookup(source,sale_id)` retourne un marqueur effectivement relu après le commit Windows. **Ne pas utiliser de fonction factice hors tests.**

Le développeur Windows devra :
1. Examiner le schéma et les règles exactes dans une copie SQLite de `ty_bufala.db`.
2. Rapprocher produits, unités, taux de TVA, caisse, règlement et annulations : aucune supposition.
3. Créer dans la base Windows un marqueur unique `(source, sale_id)` et faire la saisie commerciale **dans la même transaction que ce marqueur**.
4. À chaque réessai après crash, relire ce marqueur **avant** de saisir une nouvelle vente.
5. Prévoir une écriture retour authentifiée sur l'API mobile pour annoncer les intégrations effectives, en conservant les états de correction et d'erreur.

## Tests

```sh
python -m pytest -q tests/test_staging.py
```

Les tests couvrent les réimportations, révisions, annulations, preuves d'intégration, collisions de marqueurs, comptage exact au centime et rollback en cas de fichier corrompu. Tests artificiels exclusivement.

**Ne pas fusionner à l'aveugle avec Work :** ce dossier est indépendant du moteur API multiutilisateur. Il sert de point de départ vérifiable pour le connecteur Windows quand le schéma réel sera disponible.