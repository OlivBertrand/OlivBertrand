-- Ty Bufala Mobile — portable SQLite v1, source/import format (NOT a shared multiuser file).
-- No personal livestock information is included in this schema.
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_files (
  source_id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL,
  import_mode TEXT NOT NULL DEFAULT 'initial_snapshot',
  source_kind TEXT NOT NULL DEFAULT 'xlsx',
  notes TEXT
);
-- Lossless cached-value and Excel-formula provenance. Keep even formula-only cells.
-- Exact original workbook stored privately for fully reproducible forensic audit.
CREATE TABLE IF NOT EXISTS source_archives (
  source_id TEXT PRIMARY KEY REFERENCES source_files(source_id),
  original_size_bytes INTEGER NOT NULL,
  contents BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS source_cells (
  source_id TEXT NOT NULL REFERENCES source_files(source_id),
  sheet_name TEXT NOT NULL,
  cell_address TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  source_column INTEGER NOT NULL,
  cached_value_json TEXT,
  source_formula TEXT,
  cell_type TEXT,
  cell_style TEXT,
  PRIMARY KEY(source_id, sheet_name, cell_address)
);
CREATE INDEX IF NOT EXISTS idx_source_cells_row ON source_cells(source_id, sheet_name, source_row);
CREATE TABLE IF NOT EXISTS animals (
  id TEXT PRIMARY KEY,
  national_id TEXT NOT NULL UNIQUE,
  national_id_original TEXT NOT NULL,
  work_number TEXT,
  name TEXT,
  sex TEXT CHECK(sex IN ('F','M') OR sex IS NULL),
  birth_date TEXT,
  last_calving_date TEXT,
  mating_date TEXT,
  predicted_calving_date TEXT,
  predicted_calving_status TEXT NOT NULL DEFAULT 'estimate_unverified',
  weaning_date TEXT,
  introduced_at TEXT,
  exited_at TEXT,
  exit_reason TEXT,
  notes TEXT,
  ede TEXT,
  lactation_potential_raw TEXT,
  summer_milk_raw TEXT,
  status TEXT NOT NULL CHECK(status IN ('present','sorti')),
  source_id TEXT NOT NULL REFERENCES source_files(source_id),
  source_row INTEGER NOT NULL,
  original_fields_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_animals_status ON animals(status);
CREATE INDEX IF NOT EXISTS idx_animals_name ON animals(name);
CREATE INDEX IF NOT EXISTS idx_animals_birth ON animals(birth_date);
CREATE TABLE IF NOT EXISTS animal_parents (
  child_id TEXT NOT NULL REFERENCES animals(id),
  parent_role TEXT NOT NULL CHECK(parent_role IN ('mother','father')),
  parent_id TEXT REFERENCES animals(id),
  original_reference TEXT NOT NULL,
  resolution_status TEXT NOT NULL CHECK(resolution_status IN ('exact_id','unique_name','ambiguous','unresolved')),
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
  source_row INTEGER NOT NULL,
  PRIMARY KEY(child_id,parent_role),
  CHECK (parent_id IS NULL OR parent_id != child_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_by_parent_id ON animal_parents(parent_id,parent_role);
CREATE TABLE IF NOT EXISTS animal_events (
  id TEXT PRIMARY KEY,
  animal_id TEXT REFERENCES animals(id),
  target_reference TEXT,
  event_type TEXT NOT NULL,
  event_date TEXT,
  date_precision TEXT NOT NULL CHECK(date_precision IN ('day','unknown')),
  description TEXT,
  next_date TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  source_id TEXT REFERENCES source_files(source_id),
  source_sheet TEXT,
  source_row INTEGER,
  origin TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  tombstone INTEGER NOT NULL DEFAULT 0 CHECK(tombstone IN (0,1)),
  CHECK((event_date IS NULL AND date_precision='unknown') OR (event_date IS NOT NULL AND date_precision='day'))
);
CREATE INDEX IF NOT EXISTS idx_animal_events_animal_date ON animal_events(animal_id,event_date);
-- Optional structured records attached to an animal event. Stored only when entered;
-- no medication or withdrawal period is inferred from historic free-text notes.
CREATE TABLE IF NOT EXISTS veterinary_treatments (
  id TEXT PRIMARY KEY,
  animal_event_id TEXT NOT NULL UNIQUE REFERENCES animal_events(id),
  medication_name TEXT,
  dose_value TEXT,
  dose_unit TEXT,
  administration_route TEXT,
  batch_number TEXT,
  start_date TEXT,
  end_date TEXT,
  prescriber TEXT,
  withdrawal_milk_until TEXT,
  withdrawal_meat_until TEXT,
  withdrawal_source_note TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_attachments (
  id TEXT PRIMARY KEY,
  animal_event_id TEXT NOT NULL REFERENCES animal_events(id),
  file_name TEXT NOT NULL,
  mime_type TEXT,
  sha256 TEXT,
  private_storage_key TEXT NOT NULL,
  uploaded_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS farm_notes (
  id TEXT PRIMARY KEY,
  note_date TEXT,
  label TEXT,
  note_text TEXT,
  source_id TEXT NOT NULL REFERENCES source_files(source_id),
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_descendance (
  source_id TEXT NOT NULL REFERENCES source_files(source_id),
  source_row INTEGER NOT NULL,
  mother_label TEXT NOT NULL,
  cached_count INTEGER,
  descendant_labels_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT 'Derived workbook view, not a confirmed independent animal register',
  PRIMARY KEY(source_id, source_row)
);
CREATE TABLE IF NOT EXISTS unresolved_inventory_rows (
  source_id TEXT NOT NULL REFERENCES source_files(source_id),
  source_row INTEGER NOT NULL,
  reason TEXT NOT NULL,
  original_fields_json TEXT NOT NULL,
  PRIMARY KEY(source_id, source_row)
);
-- Sales schema: precise TTC cents and decimal milli-units, no float-based money.
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  sale_date TEXT NOT NULL,
  channel TEXT,
  client_reference TEXT,
  customer_label TEXT,
  notes TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  total_gross_cents INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','validated','voided')),
  sync_state TEXT NOT NULL DEFAULT 'local' CHECK(sync_state IN ('local','queued','received','integrated','rejected','conflict')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_system,source_object_id)
);
CREATE TABLE IF NOT EXISTS sale_lines (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL,
  product_code TEXT,
  product_label TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  unit TEXT NOT NULL,
  unit_price_gross_cents INTEGER NOT NULL CHECK(unit_price_gross_cents>=0),
  tax_rate_basis_points INTEGER,
  line_gross_cents INTEGER NOT NULL CHECK(line_gross_cents>=0),
  UNIQUE(sale_id,line_number)
);
CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  external_reference TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_devices (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES actors(id),
  label TEXT,
  last_seen_at TEXT,
  cursor TEXT
);
CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  device_id TEXT,
  actor_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_revision INTEGER,
  new_revision INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('create','update','void','restore')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','received','integrated','rejected','conflict')),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  ack_json TEXT,
  UNIQUE(source_system,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_operations_state ON sync_operations(state,created_at);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_revision INTEGER,
  remote_revision INTEGER,
  payload_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_json TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  device_id TEXT,
  before_json TEXT,
  after_json TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type,entity_id,recorded_at);

-- Read-only convenience projections for Work/Windows adapters.
CREATE VIEW IF NOT EXISTS v_active_animals AS
SELECT id, national_id, work_number, name, sex, birth_date, status,
       last_calving_date, predicted_calving_date, revision
FROM animals WHERE deleted_at IS NULL AND status='present';
CREATE VIEW IF NOT EXISTS v_lineage AS
SELECT c.id AS child_id, c.national_id AS child_national_id, c.name AS child_name,
       p.parent_role, p.parent_id, parent.national_id AS parent_national_id,
       parent.name AS parent_name, p.original_reference, p.resolution_status, p.confirmed
FROM animals AS c
JOIN animal_parents AS p ON p.child_id=c.id
LEFT JOIN animals AS parent ON parent.id=p.parent_id;
CREATE VIEW IF NOT EXISTS v_sales_control AS
SELECT s.id AS sale_id, s.source_system, s.source_object_id, s.lifecycle, s.sync_state,
       s.total_gross_cents,
       COALESCE((SELECT SUM(l.line_gross_cents) FROM sale_lines AS l WHERE l.sale_id=s.id),0) AS sum_lines_cents,
       COALESCE((SELECT SUM(p.amount_cents) FROM sale_payments AS p WHERE p.sale_id=s.id),0) AS sum_payments_cents
FROM sales s;
-- Remove nothing silently: all modifications require soft status / audit event.
CREATE TRIGGER IF NOT EXISTS animals_no_hard_delete BEFORE DELETE ON animals
BEGIN SELECT RAISE(ABORT,'animals cannot be hard-deleted; archive with audit trail'); END;
CREATE TRIGGER IF NOT EXISTS events_no_hard_delete BEFORE DELETE ON animal_events
BEGIN SELECT RAISE(ABORT,'animal_events cannot be hard-deleted; use tombstone with audit'); END;
CREATE TRIGGER IF NOT EXISTS sales_no_hard_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT,'sales cannot be hard-deleted; void with audit'); END;