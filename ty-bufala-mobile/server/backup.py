"""Consistent full backup; controlled restore only into an empty database."""
import argparse
import json
import os
from pathlib import Path
from .store import Store, utcnow
from .domain import public_record


def snapshot(store, include_archive=True):
    with store.transaction(write=True) as db:
        store.lock(db)
        records=db.execute('SELECT * FROM records ORDER BY kind,id').fetchall()
        history=db.execute('SELECT * FROM changes ORDER BY seq').fetchall()
        imports=db.execute('SELECT * FROM imports ORDER BY imported_at' if include_archive else 'SELECT digest,source,report,imported_at FROM imports ORDER BY imported_at').fetchall()
        ops=db.execute('SELECT * FROM operations ORDER BY id').fetchall() if include_archive else []
        identities=db.execute('SELECT * FROM identities ORDER BY tag').fetchall()
        sales_metadata=db.execute("SELECT key,value FROM metadata WHERE key='sales_catalogue' OR key LIKE 'sales_catalogue:%' OR key LIKE 'sales_receipt:%' ORDER BY key").fetchall()
    return {'application':'ty-bufala-mobile','formatVersion':2,'kind':'central-backup','exportedAt':utcnow(),
            'records':[dict(r) for r in records],'history':[dict(r) for r in history],
            'imports':[dict(r) for r in imports],'operations':[dict(r) for r in ops],
            'identities':[dict(r) for r in identities],'salesMetadata':[dict(r) for r in sales_metadata],'complete':include_archive}


def restore_empty(store, data):
    if data.get('application')!='ty-bufala-mobile' or data.get('formatVersion')!=2 or data.get('kind')!='central-backup' or data.get('complete') is not True:
        raise ValueError('Sauvegarde centrale complète requise')
    with store.transaction(write=True) as db:
        store.lock(db)
        for table in ['records','changes','imports','identities','operations']:
            if db.execute('SELECT 1 FROM '+table+' LIMIT 1').fetchone():
                raise ValueError('Restauration refusée : destination non vide')
        if db.execute("SELECT 1 FROM metadata WHERE key='sales_catalogue' OR key LIKE 'sales_catalogue:%' OR key LIKE 'sales_receipt:%' LIMIT 1").fetchone():
            raise ValueError('Restauration refusée : catalogue ou accusés déjà présents')
        for row in data.get('salesMetadata',[]):
            if set(row)!={'key','value'} or not (row['key']=='sales_catalogue' or row['key'].startswith(('sales_catalogue:','sales_receipt:'))):
                raise ValueError('Métadonnée de sauvegarde non autorisée')
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?)',(row['key'],row['value']))
        for table, key, columns in [('records','records',['kind','id','revision','data','author','device_id','changed_at']),('changes','history',['seq','kind','record_id','revision','data','author','device_id','changed_at']),('imports','imports',['digest','source','archive','report','imported_at']),('operations','operations',['id','user_id','fingerprint','result']),('identities','identities',['tag','animal_id'])]:
            for row in data[key]:
                db.execute('INSERT INTO '+table+'('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',tuple(row[c] for c in columns))
        if store.postgres:
            db.execute("SELECT setval(pg_get_serial_sequence('changes','seq'), COALESCE((SELECT MAX(seq) FROM changes),1), EXISTS(SELECT 1 FROM changes))")


def main():
    p=argparse.ArgumentParser()
    p.add_argument('action',choices=['export','restore-empty'])
    p.add_argument('file',type=Path)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args();store=Store(os.environ['DATABASE_URL']);store.initialize()
    if args.action=='export':
        args.file.write_text(json.dumps(snapshot(store),ensure_ascii=False,indent=2),encoding='utf-8')
        os.chmod(args.file,0o600)
    else:
        if not args.apply:p.error('Restauration à valider, puis --apply sur destination vide')
        restore_empty(store,json.loads(args.file.read_text(encoding='utf-8')))
    print('Opération terminée. Comptes et secrets exclus de la sauvegarde métier.')


if __name__=='__main__':main()
