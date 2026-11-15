# Passerelle Windows — préparation raccordée, comptabilité non activée

Le module `tools/windows_staging.py` reprend le sas fourni dans
`Ty_Bufala_passerelle_Windows_staging.zip`. Son protocole est maintenant testé
contre le vrai moteur de ventes et l'export du serveur mobile.

## Export limité aux ventes

`GET /api/windows-staging` exige une session d'administrateur et renvoie :

- `application: ty-bufala-mobile`, `kind: windows-staging`, `formatVersion: 1` ;
- `salesComplete: true` et l'ensemble des versions courantes des ventes ;
- `windowsIntegrated: false` : cet export ne vaut jamais intégration Windows.

Aucune fiche animale, cellule Excel, archive, session ou mot de passe n'est
incluse. Les noms clients et détails des ventes restent privés : ne pas publier
cet export sur GitHub ou avec les fichiers statiques Render. Une réponse HTTP
réussie ne constitue pas une saisie comptable ni un accusé Windows.

Le sas accepte aussi l'ancien export administrateur central v2, pour
compatibilité. Pour les nouveaux transferts, préférer l'export limité ci-dessus.
Les identifiants contenant `:` sont conservés. La relecture d'un reçu déjà
vérifié contrôle également l'identité de la vente dans le marqueur Windows.

## Commande locale sur copie de développement

Depuis `ty-bufala-mobile/`, après récupération privée de l'export :

```sh
python -m tools.windows_staging --ledger /chemin/prive/mobile-staging.db stage /chemin/prive/ventes.json
python -m tools.windows_staging --ledger /chemin/prive/mobile-staging.db status
```

Le journal de préparation est séparé de `ty_bufala.db`. Ne pas le partager en
écriture simultanée par synchronisation de fichier. Les corrections remplacent
les versions en attente sans créer une deuxième vente ; une annulation avant
intégration sort de la file de préparation. Toute correction après un reçu
Windows exige une revue, sans nouvelle écriture comptable automatique.

## Vérification

Les tests comprennent vingt exports du serveur réellement relus par le sas :
une seule vente reste en préparation, aucun reçu Windows n'est fabriqué. Une
annulation ultérieure est conservée avec la nouvelle révision. Les accès sans
session et éditeur sont refusés ; l'export est `no-store` et le fichier Python
ne peut pas être téléchargé par l'API publique.

## Limites

Le téléchargement automatique authentifié depuis le PC, l'écriture dans les
vraies tables de caisse, le catalogue, la TVA, les paiements, le marqueur
transactionnel Windows et le retour d'accusé au serveur restent à raccorder
après examen de la version Windows actuelle. Aucun faux marqueur ne doit être
utilisé hors tests. Le dépôt ne contient ni la base comptable ni de données
réelles. Les sauvegardes V70 ont été repérées dans OneDrive, sans téléchargement
confirmé ni examen de leur contenu à ce stade.
