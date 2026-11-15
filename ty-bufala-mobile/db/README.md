# SQLite migration v1 — private data handoff for Work

The **source `.xlsx` file is only an import/archive**, and the generated SQLite database is a **portable private seed**, **not** the shared multi-user database or an Android runtime database. For three or more concurrent phones, deploy a PostgreSQL API with authentication and offline queues; make Windows `ty_bufala.db` and OneDrive Excel consumers/exports of that service, never live-synchronise one SQLite file over OneDrive.

## Run

```sh
python db/migrate_inventory.py --input '/secure/Inventaire bufflonnes NEW(5).xlsx' --output '/secure/Ty_Bufala_inventaire_reference_v1.sqlite3'
python db/migrate_inventory.py --check '/secure/Ty_Bufala_inventaire_reference_v1.sqlite3'
```

Requires Python standard library only; refuses to overwrite an existing DB. Source Excel formulas + cached values from all three sheets are preserved in `source_cells` (including formula-only cells), and the source file fingerprint is recorded. `animals` has canonical unique national IDs; parent references remain unresolved rather than guessing. `legacy_descendance` is recorded as **derived references**, not treated as additional birth certificates. `Événements` dates that are absent remain `NULL`. `unresolved_inventory_rows` keeps rows containing a name or placeholders without an ID.

`animal_events` includes 4 explicitly typed source events, plus introduction/exit milestones from source columns where dated. No automatically-calculated predicted calving is represented as a confirmed birth.

A real cloud sync protocol is still Work's responsibility: auth/roles, versioning, API, transactional idempotence, conflict handling, outbox acknowledgments, and Windows schema adapters. No live OneDrive or Ty Bufala Windows DB is modified by this script.

**Privacy:** never commit a generated `.sqlite3`, `.db`, source `.xlsx`, or exported animal JSON to the public GitHub repository. The repo stores migration source code and tests only.