# Render + OneDrive — chantier gratuit, expérimental

Décision du 15 novembre 2026 : budget supplémentaire strictement nul ; conserver
Render et OneDrive. Aucun service payant, aucune création de compte utilisateur,
aucun import de données réelles autorisé implicitement par ces travaux.

## Implémentation en branche, non activée

Le serveur peut reconstruire SQLite **en mémoire** depuis une chaîne de
transactions SQL dans un dossier OneDrive privé dédié. Les fichiers séquentiels
`transaction-000000000001.json`, etc. sont créés avec le comportement Microsoft
Graph `conflictBehavior=fail`. Aucun fichier existant n'est remplacé.

Chaque transaction conserve les écritures de fiches, événements, identifiants,
révisions, journal, reçus et sessions. Elle n'est acquittée qu'après publication
et relecture de son enveloppe. Les mots de passe hachés et sessions font aussi
partie de ce journal : son dossier ne doit jamais être public, partagé comme un
export métier, publié sur GitHub ou servi par la PWA.

Deux processus partant de la même génération doivent entrer en conflit sur le
nom du fichier suivant : le perdant renvoie 503, le téléphone conserve les mêmes
identifiants d'opération et réessaie. Après relecture, les révisions métier
peuvent alors produire un conflit 409 à résoudre par l'utilisateur.

Un processus interrompu après publication mais avant la réponse est récupéré
par relecture du reçu durable. Un fichier absent au démarrage ne crée jamais
silencieusement une exploitation vide. Une chaîne invalide bloque les écritures.

Aucun verrou en mémoire ni fichier SQLite sur le disque Render n'est utilisé
comme autorité. Le classeur Excel d'origine n'est pas modifié.

## Limites qui empêchent encore une mise en service

- Un premier essai Graph réel, le 15 novembre 2026, valide dépôt/relecture et
  concurrence sur un dossier neuf de l'application : une écriture est confirmée,
  l'autre est refusée HTTP 409 dès la création de sa session, puis le contenu
  gagnant est relu. Les réponses perdues et la concurrence à plus grande échelle
  restent à éprouver en réel ; ce résultat n'est pas une preuve générale des
  garanties de Microsoft. Les autres scénarios restent couverts par un stockage
  distant de test atomique.
- L'application Microsoft `Ty Bufala Mobile Render` est enregistrée pour les
  comptes personnels (client `ebf06cf9-f27b-40bd-9b02-383e8b48a8de`). Les droits
  AppFolder et offline_access ont été consentis explicitement le 15 novembre
  2026, après validation Authenticator ; le mode client public est activé.
  `server.microsoft_auth` prépare une connexion par code
  d'appareil et renouvelle les jetons dans un cache local privé, uniquement pour
  les essais opérateur. La conservation durable de cette rotation sur Render
  reste à résoudre : son disque éphémère ne convient pas. Un jeton expiré doit
  bloquer, jamais acquitter faussement une saisie.
  Le coffre chiffré GitHub privé est désormais implémenté en branche, avec
  renouvellement des accès GitHub App et écritures conditionnelles : voir
  `OAUTH_VAULT.md`. Ses essais distants et son activation restent en attente.
- Le journal est intégralement relu à chaque transaction. Cela limite son usage
  à un prototype ; coûts réseau, latence, quotas, taille et compactage cohérent
  doivent être mesurés avant de le proposer pour l'usage quotidien. L'essai réel
  ci-dessous a duré 235,7 secondes au total dans l'environnement de test : il ne
  permet pas de promettre une interface quotidienne fluide. Une lecture de
  métadonnées redondante par fichier a ensuite été supprimée ; le contrôle de
  l'eTag après téléchargement est conservé.
- Les anciens fichiers doivent rester immuables : aucune suppression ou édition
  manuelle ; empreinte SHA-256 et chaîne détectent des corruptions, mais ne sont
  pas une signature et ne protègent pas contre un détenteur malveillant des
  droits OneDrive. La suppression d'une fin du journal exige une procédure de
  détection de recul et restauration à développer.
- Le plan Render est actuellement Free. Les plafonds de facturation du workspace
  ne sont pas vérifiés par ces travaux : le plan Free seul ne garantit pas
  l'absence de frais de dépassement de trafic ou de compilation.
- La base privée `Ty_Bufala_inventaire_reference_v1.db` a été vérifiée en lecture
  seule (`quick_check=ok`, aucune erreur de clé étrangère). Le nouvel importeur
  `server.reference_import` a importé 98 animaux et 86 événements dans une base
  privée locale jetable, puis vérifié un réimport sans doublon et la conservation
  binaire complète de la source. Les 175 références parentales restent non
  confirmées. Les notes, lignes non identifiées et descendance historique sont
  conservées dans le rapport privé et la base archivée. Cet essai n'est pas un
  import en production ni une vérification de la version OneDrive actuelle.

## Garde-fous techniques

Le chemin `DATABASE_URL=onedrive-journal://` refuse de fonctionner sans
`TB_ONEDRIVE_EXPERIMENTAL=1`. Même avec ce drapeau, il exige
`MS_GRAPH_ACCESS_TOKEN`, `TB_ONEDRIVE_DRIVE_ID` et
`TB_ONEDRIVE_JOURNAL_FOLDER_ID`, puis un journal déjà initialisé. Ne pas activer
ces variables sur le service réel avant levée des limites ci-dessus.

Le bootstrap `JournalStore(remote, allow_empty=True).initialize()` est réservé
aux tests ou à une préparation administrative explicitement validée. Il n'est
pas exposé par l'API. Les API ne servent jamais le dossier OneDrive.

## Essais

### Connexion et essai Graph réels (opérateur, consentement préalable)

Le mode client public de cette application est activé dans Microsoft.
L'utilisateur a autorisé **uniquement** le dossier de l'application et le
renouvellement de cette connexion. Le code ne demande pas User.Read ni l'accès
à tous les fichiers. Ne pas placer les caches dans ce dépôt, les logs ou la PWA.

Depuis `ty-bufala-mobile`, avec des chemins privés en dehors du dépôt :

```sh
python3 -m server.microsoft_auth begin --pending /CHEMIN_PRIVE/microsoft-pending.json
python3 -m server.microsoft_auth poll --pending /CHEMIN_PRIVE/microsoft-pending.json --tokens /CHEMIN_PRIVE/microsoft-tokens.json
python3 -m tools.onedrive_probe --tokens /CHEMIN_PRIVE/microsoft-tokens.json
```

`begin` affiche seulement le code utilisateur et l'adresse Microsoft. `poll`
effectue une seule vérification et indique le délai avant de réessayer, sans
afficher les jetons. Le cache (permissions 0600, remplacement atomique) convient
à un opérateur unique sur disque privé persistant, pas à plusieurs processus.

Le probe crée un dossier neuf `verification-synthetique-<aléatoire>` dans
l'approot de l'application, et deux petits fichiers fictifs. Il ne supprime
rien. Les deux tentatives de création de session se terminent avant tout dépôt ;
Microsoft peut déjà refuser la seconde à cette étape. Une seule écriture doit
réussir, l'autre doit refuser le conflit, puis
le contenu gagnant est relu. Un succès ne valide pas encore la latence, le
compactage, la restauration ou la durabilité OAuth en production.

Les premiers essais ont révélé une erreur de synchronisation dans le probe :
une session refusée ne libérait pas l'autre participant. Le correctif est couvert
par deux tests de régression (refus à la création de session ou au dépôt).
L'essai corrigé passe en réel : un succès et un conflit à la création de session.

Le journal SQL a aussi été éprouvé dans ce dossier fictif : initialisation,
enregistrement d'un animal fictif, reconstruction depuis une nouvelle instance,
répétition exacte de l'opération puis comptage. Résultat réel : un seul
enregistrement, une seule modification et le même reçu lors du nouvel envoi.
Durée totale mesurée : 235,7 secondes. Aucun animal de référence ni utilisateur
réel n'a été importé. Cette restauration réussie ne résout pas les limites de
performance et de conservation durable des jetons sur Render.

La suite Python compte maintenant 50 tests réussis, dont deux régressions du
probe et un contrôle du téléchargement optimisé : l'eTag est toujours comparé
après lecture et le jeton Graph n'est jamais transmis à l'hôte de stockage.

`tests/test_microsoft_auth.py` vérifie les délais de polling, le refus/expiration,
le rejet des droits élargis, les caches privés et la rotation après redémarrage.

`python3 -m pytest -q tests/test_onedrive_store.py` vérifie reconstruction après
redémarrage, reçus persistants, réponse perdue, panne distante, groupe annulé,
concurrence entre deux instances, corruption, journal manquant, lecture seule,
blocage expérimental et absence d'accusé API sur échec distant.
