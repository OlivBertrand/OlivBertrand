# Ty Bufala Mobile — cache d'optimisation OneDrive (mode expérimental)

## Observation de départ

Au commit Work `6501011abcc51acd68e75bef91eb2dcb27787f52`,
`JournalStore.transaction()` reconstruit toute la base depuis l'ensemble des
fichiers `transaction-*.json` à chaque requête. Cela provoque des coûts et
une latence qui augmentent avec la taille de l'historique.

## Livrables

- `server/journal_cache.py` : cache SQLite en mémoire **par processus**.
  À chaque transaction suivante, vérifie la dernière entrée distante et
  rejoue seulement les entrées nouvelles.
- `server/cached_onedrive_store.py` : adaptation des transactions. Chaque
  transaction utilise une copie SQLite isolée et le cache n'avance qu'après
  validation Graph de l'écriture distante.
- Activation **facultative et désactivée par défaut** :
  `TB_ONEDRIVE_FAST_REPLAY=1` (en plus des protections préexistantes).
- 7 tests locaux de cache réussis, 4 tests d'intégration à exécuter par Work.

## Ce que ce prototype ne résout pas

- Le démarrage froid Render Free exige toujours de reconstruire l'historique.
- Le nombre de requêtes Graph reste non négligeable même avec cache chaud.
- Les mesures sur données simulées ne donnent aucune estimation fiable des
  latences Microsoft Graph réelles.
- Le cache vérifie la dernière entrée connue et les nouvelles transactions,
  mais ne vérifie pas chaque ancien segment intermédiaire à chaque appel :
  une altération d'un segment historique peut rester indétectée pendant une
  session chaude. Il faut tester des audits intégraux périodiques / snapshots
  signés, et une procédure de récupération avant l'usage en production.
- Il n'offre aucune solution de conservation durable des jetons OAuth.

**Ne pas activer sur la production ni importer le cheptel réel avant la levée
et la validation indépendante des deux derniers blocages.** Aucun fichier de
cheptel, token ou secret n'est stocké dans cette branche GitHub publique.