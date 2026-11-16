# Ty Bufala Mobile — tableau de bord du cheptel, pour Work

## Objectif
Afficher dès l'accueil les effectifs du cheptel **présent**, avec des catégories exclusives et filtrables, puis maintenir l'aperçu en accord avec le cache local synchronisé, sans faire passer un calcul estimatif pour un état reproductif confirmé.

## Fonctionnement
- 9 catégories exclusives : en lactation, taries, génisses confirmées, jeunes femelles de moins de 12 mois, jeunes mâles de moins de 24 mois, taureaux reproducteurs confirmés, autres mâles adultes, femelles à préciser, autres à préciser.
- La somme des catégories doit être égale à l'effectif de fiches `status=present` ; les animaux sortis/archivés sont exclus.
- Les déductions par date de naissance ne sont utilisées que pour l'âge, jamais pour affirmer tarissement ou lactation.
- Les fiches affichent et permettent de modifier `productionStatus` (`lactating`, `dry` ou vide), `reproductiveStatus` (`heifer`, `calved` ou vide), `maleRole` (`breeding_bull`, `other` ou vide), `productionStatusDate`.
- Les événements `Tarissement` / `Mise en lactation` proposent explicitement de mettre à jour le statut actuel (si l'événement n'est pas antérieur au statut connu), dans le même lot atomique que l'événement. Ils ne le font jamais silencieusement.
- Les cartes ouvrent le cheptel filtré sur le profil. Un bouton Actualiser force la synchronisation. La vue se met à jour immédiatement après les écritures locales et après les lectures du serveur ; la fréquence du polling existant est d'environ 30 secondes quand l'application reste active. Ne pas appeler cela du streaming temps réel garanti.
- Le serveur refuse les combinaisons invalides (mâle tarie, femelle taureau, génisse avec vêlage/lactation, etc.). Les fiches historiques non catégorisées restent compatibles.

## Tests
`node --test tests/herd-overview.test.cjs` : 6 scénarios validés localement.
`python3 -m pytest -q tests/test_herd_categories.py` : scénarios de validation serveur à exécuter dans l'environnement Work avec les dépendances du serveur.

## Intégration
- Basé sur `work/ty-bufala-mobile-shared` au commit `8e6a43c080dfd98f13e25f29974c36fe22fd73af`.
- N'intègre aucune donnée privée et n'active pas OneDrive ou Render en production.
- Work doit examiner les règles métier des seuils d'âge (moins de 12 mois pour les jeunes femelles, moins de 24 mois pour les jeunes mâles). Ces seuils sont des paramètres d'affichage, pas des diagnostics zootechniques.
- Lors de la reprise des 98 animaux réels, la plupart des femelles adultes resteront « à préciser » tant que lactation/tarissement et statut génisse n'ont pas été validés. Ne pas les répartir automatiquement par une date de vêlage théorique.
- Eviter de fusionner automatiquement cette branche si Work modifie simultanément `app.js` ou `server/domain.py`.