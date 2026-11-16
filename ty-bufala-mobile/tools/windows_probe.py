"""Run on a COPY of DEV-isole. Read-only metadata; no production database writes."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('database',type=Path)
p.add_argument('--code',type=Path,required=True)
p.add_argument('--output',type=Path,default=Path('ty_bufala_schema_developpement.json'))
a=p.parse_args()
if not a.database.is_file() or not a.code.is_dir():p.error('Base et dossier de code nécessaires')
# SQLite immutable avoids WAL participation; use a closed, consistent backup/copy.
uri=a.database.resolve().as_uri()+'?mode=ro&immutable=1'
with sqlite3.connect(uri,uri=True) as db:
    db.execute('PRAGMA query_only=ON')
    objects=[{'type':r[0],'name':r[1],'sql':r[2]} for r in db.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
    columns={obj['name']:[list(r) for r in db.execute('PRAGMA table_info("'+obj['name'].replace('"','""')+'")')] for obj in objects if obj['type']=='table'}
files=[{'path':str(f.relative_to(a.code)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in a.code.rglob('*.py') if '.git' not in f.parts]
a.output.write_text(json.dumps({'objects':objects,'columns':columns,'pythonFiles':files,'containsBusinessRows':False},ensure_ascii=False,indent=2),encoding='utf-8')
print('Schéma extrait en lecture seule. Aucune ligne métier exportée. Fournir aussi les modules Python ventes/produits/imports pour étudier les règles réelles.')
