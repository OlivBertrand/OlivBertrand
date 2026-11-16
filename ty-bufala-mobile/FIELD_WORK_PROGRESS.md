# Cheptel terrain — état du 16 novembre 2026

Branche de développement `work/tybufala-field-ui`, PR #11 empilée sur #10. Aucun déploiement, fusion ou import partagé réel.

## Lot A

Commit `7276acb554c213372c2b7b11ca6a21206d7381fb` : faits reproductifs structurés (confirmation, résultat diagnostic, taureau par ID), synthèse prudente et ligne du temps filtrable. Chaleur/saillie ne confirment pas la gestation. Prédictions, faits incertains, dates inconnues et futures ne deviennent pas des diagnostics. Contradictions le même jour signalées ; faits de plus d'un an nécessitent un contrôle. Actions terrain de lactation et présence enregistrées atomiquement avec leur événement. Les corrections restent dans le journal de révisions serveur.

Validation : 83 tests Python, 18 tests JS de domaine et 3 scénarios HTTP/IndexedDB/DOM réussis. Le scénario DOM exige la mère exacte en présence d'une seconde femelle, suit son lien stable et teste diagnostics positive/négative, tarissement/lactation, sortie/retour et compteurs. Aucune validation visuelle Android revendiquée.

## Lot B

Importeur existant réutilisé ; 73 dates supplémentaires présentées en événements de provenance Excel, incertains ou prévisionnels, en plus des 86 événements historiques. Les parents proposés ne deviennent pas des filiations confirmées. Les rares parents confirmés sont ordonnés avant leurs descendants pour valider leurs IDs.

Essai privé jetable avec la base jointe : 98 animaux, 63 présents, 35 sortis ; 86 événements conservés + 73 dates = 159 entrées ; 175 références parentales incertaines préservées. Les 28 derniers vêlages, 20 mises à la reproduction, 16 prévisions et 9 sevrages restent des données historiques à confirmer. Le SHA-256 du classeur joint correspond à celui de l'archive embarquée.

Réimport sans aucun changement des fiches/reçus. Sauvegarde complète puis restauration dans une autre base privée : égalité exacte des records, historique, archives, reçus et identités. Un nouvel import depuis l'archive constitue une nouvelle opération avec de nouvelles dates techniques ; la restauration exacte utilise bien la sauvegarde complète.

Ces essais ne prouvent pas encore la persistance OneDrive/Render. Coffre OAuth bloqué par la récupération PEM ; pas de nouvelle tentative de contournement. Import partagé réel soumis à validation du coffre/journal/restauration et à accord utilisateur. Aucun animal ni classeur réel publié dans GitHub.

## Suite

Lot C développé : définitions et affectations séparées à IDs stables, révisions, étiquettes actives uniques, lot courant unique, clôtures et historique, sélection collective et lots atomiques de 25 animaux, filtres combinés et compteurs cliquables. Annulation logique d’événement, historique serveur consultable, statut reproductif recalculé. Annuler/corriger un vêlage exige de vérifier la fiche maternelle ; aucun descendant n’est supprimé. L’annulation d’un ancien changement de lactation/présence/lot signale explicitement qu’il faut vérifier la donnée courante, sans retour automatique.

Essais : 87 tests Python, 18 tests JS de domaine, 4 scénarios HTTP/IndexedDB/DOM. Le parcours DOM sélectionne huit génisses, ajoute deux étiquettes puis répète une affectation sans doublon, affecte un lot et combine génisses + étiquette + lot. Le redémarrage du client conserve une affectation hors ligne en attente, ensuite reçue par un autre compte.

Lot D en développement indépendant. L'intégration dans la version Windows actuelle nécessite son code source exact et une copie cohérente de sa base. Les ressources trouvées jusqu'ici incluent des éléments plus anciens ; elles ne prouvent pas l'accès à la version courante.

Références Windows retrouvées dans les échanges récents : V70.4, révision `0e788d4a1a915db25c585007d0717bb0cd64b653`, et paquet connecteur `TY_BUFALA_BLEEZ_V705_FENETRE_WINDOWS_CORRIGEE.zip`. Ce SHA n’existe pas dans le dépôt GitHub mobile accessible. Le paquet V70.5 est récupéré pour inspection ; ne pas confondre ce connecteur avec le logiciel Windows complet.

## Lot D indépendant et limites de recette

Client Python `windows/herd_sync.py` livré pour la fabrique de connexions SQLite de l’hôte courant, avec tables additives préfixées, file/reçus/curseur persistants, synchronisation bidirectionnelle, conflits et étiquettes collectives. Aucun onglet Windows installé ni intégration au véritable app.py actuel n’est revendiqué. Voir `windows/HERD_INTEGRATION_HANDOFF.md`.

Essais supplémentaires : huit affectations Windows/API, correction de diagnostic, annulation, reprise de client, réponse perdue, conflit, conservation des tables métier et ordre de deux corrections hors ligne. Le statut synchronisé est interdit avant première confirmation ; des reçus incomplets ne retirent jamais le lot local.

Recette visuelle bloquée : Chromium local refuse son lancement avec `socket() failed: Operation not permitted`. Aucune restriction contournée ; DOM/IndexedDB n’est pas une validation Android réelle.

Toujours bloqués : intégration de l’onglet au HEAD Windows réellement présent dans DEV-isole, tests natifs sur copie fictive courante, récupération PEM officiellement prise en charge, persistance et restauration OneDrive/Render réelles. Aucun coût d’hébergement supplémentaire, import partagé réel ou modification de production.

Validation finale de ce lot : **91 tests Python, 19 tests JS de domaine, 5 scénarios HTTP/IndexedDB/DOM**, tous réussis. Inclut annulation de vêlage conservant le veau, absence de faux statut synchronisé initial, rejet des reçus incomplets et révisions successives hors ligne. Syntaxe JS et `git diff --check` réussis.
