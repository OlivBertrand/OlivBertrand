# Coffre OAuth privé — implémenté, essais GitHub réels en attente

État au 15 novembre 2026 : code en branche, aucune activation Render et aucun
jeton versé sur GitHub. Le dépôt privé et la GitHub App sont désormais créés,
et l'installation sur le seul dépôt du coffre a été vérifiée dans GitHub.
Le renouvellement Microsoft existant a été vérifié en
réel (nouveau jeton d'actualisation reçu et cache privé local remplacé). Cela ne
valide pas encore la conservation GitHub ni un redémarrage Render.

## Architecture retenue pour les essais

- Un dépôt **privé distinct**, créé `OlivBertrand/ty-bufala-private-state`.
  Ne jamais utiliser le dépôt public du code ou un dépôt Zantho.
- Une GitHub App installée **uniquement sur ce dépôt**, permission repository
  Contents lecture/écriture, Metadata lecture implicite, aucun webhook,
  permission de compte ou accès à Actions nécessaire.
- L'application signe un JWT RSA court pour demander un jeton d'installation
  limité à l'identifiant de ce seul dépôt et à Contents écriture. Ce jeton est
  renouvelé automatiquement avant expiration : aucun PAT utilisateur à recopier
  périodiquement. Les durées réelles renvoyées par GitHub sont respectées.
- Un fichier `state/control.json` sur la branche `main`. Il contient seulement
  une enveloppe AES-256-GCM (nonce neuf par écriture). Les jetons Microsoft sont
  chiffrés ; le contexte dépôt/branche/chemin est authentifié. Aucune donnée
  animale, vente, photo ou archive métier n'est placée dans ce dépôt.
- La clé AES et la clé privée RSA de la GitHub App sont des secrets Render
  distincts, jamais des fichiers suivis par Git ni des valeurs envoyées à la PWA.

`server/github_vault.py` exige à chaque lecture/écriture un dépôt privé dont
l'identifiant numérique correspond à la configuration. Un dépôt rendu public,
renommé hors du chemin attendu ou recréé avec le même nom est refusé.

## Rotation Microsoft, concurrence et panne

`server/oauth_vault.py` lit le cache distant après un redémarrage. Quand l'accès
expire, il utilise le refresh token conservé puis valide strictement les droits
AppFolder. Il écrit la nouvelle autorisation avec le SHA GitHub attendu et la
relit avant de l'utiliser. Un autre processus ayant changé le fichier provoque
une reprise depuis la version gagnante, pas son écrasement. Les autres champs
du contrôle sont conservés lors de la rotation.

Une réponse perdue après commit ne produit pas de succès local ; le prochain
appel retrouve le cache effectivement enregistré. Une indisponibilité GitHub ou
Microsoft, un coffre altéré ou une autorisation révoquée bloque avec HTTP 503
via le gestionnaire existant, sans acquitter une saisie non sauvegardée. Les
tokens valides déjà confirmés peuvent être réutilisés en mémoire jusqu'au
renouvellement ; chaque commit métier doit toujours être vérifié sur OneDrive.

Les jetons Microsoft ne sont jamais supposés permanents. Le retrait du
consentement peut imposer une reconnexion même avant leur échéance annoncée.

## Configuration Render (valeurs privées, aucune activation automatique)

| Variable | Rôle |
|---|---|
| `TB_OAUTH_VAULT=github` | Choisit le coffre durable plutôt que le jeton Graph temporaire |
| `TB_VAULT_REPOSITORY` | Dépôt privé dédié, owner/name |
| `TB_VAULT_REPOSITORY_ID` | Identifiant numérique vérifié du dépôt |
| `TB_VAULT_BRANCH=main` | Branche du fichier de contrôle |
| `TB_GITHUB_APP_ID` | ID ou client ID de la GitHub App |
| `TB_GITHUB_INSTALLATION_ID` | Installation limitée au dépôt privé |
| `TB_GITHUB_PRIVATE_KEY` | Clé RSA PEM privée, secret Render |
| `TB_VAULT_KEYS` | Objet JSON secret : identifiant de clé → clé AES 32 octets en base64 |
| `TB_VAULT_ACTIVE_KEY` | Identifiant de la clé de chiffrement active |

Le choix du coffre ne supprime pas les gardes existantes : stockage OneDrive
expérimental explicitement activé, identifiants du drive/dossier requis,
journal existant. Il ne crée pas d'exploitation vide au démarrage.

## Initialisation et reconnexion opérateur

La console `tools/oauth_vault_admin.py` accepte un fichier de configuration JSON
privé (mêmes variables, hors dépôt) et le chemin d'un cache Microsoft obtenu
par le parcours sécurisé existant. Elle n'affiche aucun jeton ni clé.

Depuis `ty-bufala-mobile` :

```sh
python3 -m tools.oauth_vault_admin status --config /CHEMIN_PRIVE/vault-config.json
python3 -m tools.oauth_vault_admin initialize --config /CHEMIN_PRIVE/vault-config.json --tokens /CHEMIN_PRIVE/microsoft-tokens.json
```

`initialize` refuse un coffre déjà présent. Après révocation Microsoft :

1. Refaire le parcours Microsoft par code, sans changement des scopes.
2. Utiliser `reconnect` à la place de `initialize`, avec le nouveau cache privé.
3. Redémarrer les processus utilisant d'anciens jetons en mémoire et vérifier
   une lecture/écriture fictive. Aucun endpoint public ne peut changer le coffre.

La procédure nécessite un opérateur ; elle n'est pas présentée comme une
reconnexion autonome depuis l'interface mobile. Aucune copie de mot de passe ou
de refresh token dans la conversation n'est nécessaire.

## Renouvellement du moyen d'accès au coffre

La clé GitHub App est un secret durable **révocable et remplaçable**, pas une
garantie d'accès permanent. Elle permet de recréer les jetons courts après un
redémarrage, contrairement à un jeton d'installation simplement enregistré.

Pour une rotation normale : générer une nouvelle clé privée dans la même App,
la remplacer dans les secrets Render, redémarrer, vérifier l'accès au même dépôt
privé, puis révoquer l'ancienne clé. En cas de révocation/compromission, suspendre
les écritures, révoquer d'abord l'accès concerné, remplacer la clé et reconnecter
Microsoft si nécessaire. Si l'App est désinstallée, une réinstallation limitée
au même dépôt et la mise à jour de l'installation sont nécessaires. En cas de
coffre inaccessible, le service bloque ; aucun repli vers un cache local vide.

Pour changer la clé AES : ajouter la nouvelle clé aux secrets en conservant
l'ancienne pour la lecture, choisir son ID actif, exécuter `reencrypt`, vérifier
le coffre depuis un nouveau processus avec seulement la nouvelle clé, puis
retirer l'ancienne. L'historique Git conserve les anciens chiffrés ; il ne faut
pas considérer une rotation comme leur effacement ou comme une révocation des
anciens jetons Microsoft. La récupération doit utiliser l'état courant vérifié.

## Budget et limites restant à lever

Le mécanisme n'utilise ni Actions, ni Packages, ni runner, ni base payante. Il
ne nécessite aucune installation sur le PC utilisateur. Le plan GitHub réel,
la confidentialité du nouveau dépôt, l'installation limitée et les plafonds de
facturation Render doivent encore être vérifiés avant activation. Aucun moyen
de paiement ni offre payante ne doit être ajouté.

Le CAS protège les mises à jour normales concurrentes ; il n'empêche pas un
propriétaire malveillant du dépôt de réécrire l'historique. Le record prévoit de
conserver d'autres champs de contrôle, mais l'ancrage indépendant du journal,
les snapshots et les audits de ses anciens segments ne sont pas encore
implémentés. Ne pas assimiler la réussite des tests OAuth à leur validation.

La connexion navigateur GitHub a réussi. Après autorisation explicite de
l'utilisateur, l'App `Ty Bufala Vault OlivBertrand` a été enregistrée puis
installée avec Contents lecture/écriture et Metadata lecture, sur un seul dépôt.

| Paramètre vérifié | Valeur non secrète |
|---|---|
| Dépôt privé | `OlivBertrand/ty-bufala-private-state` |
| ID du dépôt | `1458886770` |
| Branche | `main` |
| GitHub App | `ty-bufala-vault-olivbertrand` |
| App ID | `5774039` |
| Installation ID | `182330440` |

Le bouton GitHub `New key` a rencontré un blocage de politique URL du navigateur
Work (protocole non autorisé). Aucune récupération de PEM n'a été confirmée et
aucune clé n'a été enregistrée dans Render. Aucun contournement ni seconde
tentative de génération par un autre moyen automatisé n'est effectué.

Intervention nécessaire dans le navigateur habituel de l'utilisateur : ouvrir
les réglages de cette App, Credentials → Key pairs, générer/télécharger une clé,
puis enregistrer le contenu PEM directement dans `TB_GITHUB_PRIVATE_KEY` sur
le service Render de test `ty-bufala-mobile-test`. Ne pas coller la clé dans le
chat ni l'ajouter au dépôt. Les autres variables seront préparées séparément ;
ne pas activer le stockage réel à cette occasion. Si une clé non récupérée
existe déjà, son retrait est à prévoir après validation de la clé de remplacement.

La création, l'installation et la conservation de la clé dans les secrets du
service de test ont été approuvées par l'utilisateur. La persistance distante,
les essais de rotation sur GitHub et le redémarrage Render ne sont pas encore
validés.

## Validation effectuée

Les tests couvrent AES-GCM, substitution de contexte, altération, remplacement
des clés, reprise après redémarrage, conservation des nouvelles autorisations,
deux rotations concurrentes, réponse perdue après commit, panne avant commit,
révocation Microsoft, scopes élargis refusés même au redémarrage, reconnexion,
réponse API 503, signature JWT vérifiée, renouvellement des tokens GitHub et
limitation à un dépôt privé avec écriture conditionnelle par SHA.

Il reste à exécuter ces scénarios sur le dépôt GitHub privé réel puis sur le
service Render de test avant tout chargement du cheptel.
