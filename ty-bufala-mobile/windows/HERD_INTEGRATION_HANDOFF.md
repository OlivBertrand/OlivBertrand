# Raccordement Cheptel au logiciel Windows actuel

## Cible et limite actuelle

Les échanges récents identifient V70.4, révision `0e788d4a1a915db25c585007d0717bb0cd64b653`, et le connecteur Bleez V70.5. Le paquet `TY_BUFALA_BLEEZ_V705_FENETRE_WINDOWS_CORRIGEE.zip` a été récupéré et examiné : il contient le connecteur et sa fenêtre de configuration, **pas l’application Windows complète**. Le SHA V70.4 n’existe pas dans le dépôt GitHub mobile accessible à Work.

Le code courant est dans **DEV-isole** sur le PC ; relever son HEAD Git, la branche et les modifications non commises avant tout raccordement. Les chemins du PC ne sont pas montés ici. L’ancien app.py V70.1-RC1.2.6 ne doit pas recevoir une intégration supposée actuelle. Le code de production et sa base active restent exclus.

## Composant livré

`windows/herd_sync.py` : client stdlib compatible Python 3.11, connecté à l’API commune existante, sans nouveau fournisseur ni installation. Il reçoit une fabrique de connexions SQLite au fichier métier choisi par le logiciel hôte. Il ne crée pas une deuxième base métier.

`initialize_development()` est une activation explicite sur copie fictive cohérente, jamais appelée automatiquement en production. Tables additives préfixées `tb_mobile_` : fiches, file d’attente, métadonnées/curseur, reçus, conflits et historique. Ne pas copier une SQLite active en ignorant son WAL. La migration réelle doit rejoindre le mécanisme de migration de la version courante après revue.

Chaque `save()` valide les limites, crée les IDs d’opérations stables, puis enregistre la fiche locale et son lot dans une transaction `BEGIN IMMEDIATE`. Les lots collectifs de 25 animaux sont bornés ; les étapes déjà enregistrées restent identifiables si la suite échoue. Les fiches animales et leurs étiquettes ont des révisions distinctes.

`sync()` reprend la file, contrôle le compte distant, vérifie tous les reçus avant de retirer un lot, puis lit les changements et avance le curseur dans la même transaction que leur stockage. Une réponse perdue rejoue les mêmes IDs. Une coupure conserve la file. Un conflit bloque les écritures et reste à comparer ; `keep_remote()` archive explicitement les versions abandonnées et leurs lots dépendants. Il n’existe aucun écrasement automatique de la version commune.

`RemoteAPI` exige HTTPS ; cookies et CSRF restent en mémoire. Aucun identifiant, mot de passe ou jeton n’est conservé dans SQLite. L’hôte doit reconnecter la session après son redémarrage, puis reprendre la file existante. Ne pas réutiliser le coffre Bleez pour ces accès.

## Interface hôte restant à raccorder

Le nouvel onglet principal **Cheptel** et ses six vues restent à construire dans le code Windows actuel. L’adaptateur seul ne constitue pas cet onglet. Les vues doivent exposer les mêmes IDs, catégories, événements structurés et règles de confirmation que le mobile, sans interpréter les prévisions Excel comme des gestations.

Prévoir démarrage, périodicité et bouton manuel dans les workers déjà utilisés par V70.4 ; ne jamais bloquer le thread Tkinter avec une requête réseau et remonter les résultats via la file graphique existante. Les connexions SQLite sont nouvelles par appel (pas de connexion partagée entre threads). Appeler `save()` avant une confirmation de saisie locale ; afficher séparément attente, synchronisation, erreur, conflit et confirmation serveur.

Réutiliser `assign_labels()` pour ajouter/terminer/retirer collectivement, après sélection et confirmation du nombre. Pour le changement de lot : fermer l’affectation courante, créer la nouvelle et son événement dans le même lot, comme sur mobile. Les types API sont `animals`, `events`, `sales`, `labelDefinitions`, `animalLabelAssignments`, `herdGroups`, `animalGroupAssignments`.

Une annulation utilise `cancelled=true`, conserve l’ID et l’historique serveur ; elle n’efface pas le veau. La correction/annulation d’un vêlage doit proposer explicitement la vérification du dernier vêlage maternel. L’annulation d’un ancien changement de présence/lot/lactation nécessite une vérification séparée de l’état courant, et ne doit pas supposer un retour arrière silencieux.

## Vérification effectuée

Tests sur SQLite fictives et vraie API Flask locale authentifiée : transfert d’un diagnostic API vers le client Windows indépendant, correction renvoyée vers l’API, huit affectations collectives sans doublon, annulation logique reçue, réouverture de client avec file conservée, réponse perdue après commit, deux modifications hors ligne successives, conflit de révision et choix explicite de la version commune. Les anciennes tables métier fictives sont conservées.

Ce sont des essais du protocole et du composant Python sous Linux ; **pas une recette de l’application Windows installée**, ni une validation OneDrive/Render. L’onglet intégré, la synchronisation automatique depuis l’application réelle et la recette native restent bloqués par l’accès au HEAD/fichiers actuels et à une copie de développement cohérente.
