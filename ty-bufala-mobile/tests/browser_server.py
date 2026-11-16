"""Disposable localhost-only browser test server. Synthetic data, never deploy."""
import os
from pathlib import Path
from werkzeug.security import generate_password_hash
from server.app import create_app
from server.domain import apply_operations
path=os.environ['TB_BROWSER_DB']
if Path(path).exists():Path(path).unlink()
app=create_app(path,testing=True)
store=app.config['STORE']
with store.transaction(write=True) as db:
    for name in ['alice','suzanna','reader']:
        db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)',(name,name,generate_password_hash('local-test-only-password',method='scrypt'),'reader' if name=='reader' else 'editor'))
apply_operations(store,{'id':'alice','role':'editor'},[{'opId':'seed_test','deviceId':'device_seed','kind':'animals','baseRevision':0,'data':{'id':'animal_test','earTag':'FR0000000001','name':'Animal de test','sex':'F','status':'present','birthDate':'2025-01-01'}}])
app.run(host='127.0.0.1',port=8000,threaded=True)
