# Reprise sélective de la PR n° 1

Source examinée : https://github.com/OlivBertrand/OlivBertrand/pull/1, commit `baea6b502f443db24d7bf616eadf111602eaeb27`. Aucune fusion de cette PR n’a été effectuée.

## Repris et adapté

- `quality.js`, ses tests, l’onglet Contrôles et l’interface de parenté proviennent de la PR.
- La descendance inclut maintenant les liens maternels et paternels. Les cycles sont signalés, avec parcours borné par les animaux déjà visités.
- Les collisions d’ID internes à un import sont également détectées. La comparaison de contenu ne dépend plus de l’ordre des propriétés JSON.
- Les traitements structurés de la branche principale de travail sont compris par les contrôles.
- Les validations locales sont appliquées au point d’écriture des groupes, puis réappliquées côté serveur : la modification de JavaScript n’autorise pas de contourner les contrôles.
- Les calculs TTC en entiers et les prévisions non diagnostiques sont conservés.

## Réimplémenté dans le serveur durable

Les identifiants d’opération/appareil, versions, idempotence, journal et lecture incrémentale du contrat exécutable sont implémentés en SQL, avec authentification. Les reçus sont liés à l’auteur et à l’empreinte du contenu. Le groupe d’écritures est atomique.

`sync-core.js` n’est pas chargé, car l’application utilise directement la persistance et le protocole HTTP. Les protections contre la concurrence sont testées sur l’API réelle locale, pas sur un serveur en mémoire.

## Écart de source identifié

Les effectifs cités dans la PR décrivent son ancien JSON privé, pas une lecture de la dernière version OneDrive. Ils ne sont donc pas repris comme valeurs de référence dans le code. Un rapport privé séparé décrit le nouveau contrôle du classeur disponible, avec lignes non identifiées et filiations à vérifier.

## Limites de mise en service

L’accès OneDrive, les mappings Windows, le stockage durable hébergé et les comptes réels restent soumis aux accès/validations nécessaires. Aucun reçu de sauvegarde Graph ou d’intégration SQLite n’est simulé. Aucun fichier réel de cheptel n’est inclus dans cette branche.
