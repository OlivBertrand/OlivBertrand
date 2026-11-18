import copy
from concurrent.futures import ThreadPoolExecutor
import pytest
from werkzeug.security import generate_password_hash
from server.app import create_app
from server.domain import apply_operations, Rejected


@pytest.fixture
def app(tmp_path):
    app = create_app(str(tmp_path/'test.db'), testing=True)
    with app.config['STORE'].transaction(write=True) as db:
        for user, role in [('alice','admin'),('suzanna','editor'),('reader','reader')]:
            db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)', (user,user,generate_password_hash('a-long-test-password',method='scrypt'),role))
    return app


def login(app, user='alice'):
    client=app.test_client()
    response=client.post('/api/login', json={'username':user,'password':'a-long-test-password'})
    assert response.status_code==200
    return client, {'X-CSRF-Token':response.json['csrf']}


def animal(id='animal_a', tag='FR0000000001', **fields):
    return {'id':id,'earTag':tag,'sex':'F','status':'present','birthDate':'2025-01-01',**fields}


def op(data, rev=0, id='op_a', kind='animals'):
    return {'opId':id,'deviceId':'device_test','kind':kind,'baseRevision':rev,'data':data}


def push(client, headers, ops):
    return client.post('/api/sync',json={'operations':ops},headers=headers)


def test_auth_and_private_files(app):
    c=app.test_client()
    assert c.get('/api/changes').status_code==401
    for path in ['/server/app.py','/README.md','/SYNC_CONTRACT.md','/.env','/../private/test.db']:
        assert c.get(path).status_code==404
    a,h=login(app)
    assert push(a,{},[op(animal())]).status_code==403
    assert push(a,{**h,'Sec-Fetch-Site':'cross-site'},[op(animal())]).status_code==403
    assert 'HttpOnly' in a.post('/api/login',json={'username':'alice','password':'a-long-test-password'}).headers['Set-Cookie']
    r,rh=login(app,'reader')
    assert push(r,rh,[op(animal())]).status_code==403


def test_three_retries_one_record_and_receipt(app):
    a,h=login(app)
    payload=[op(animal())]
    receipts=[push(a,h,payload).json for _ in range(3)]
    assert receipts[0]==receipts[1]==receipts[2]
    assert len(a.get('/api/changes').json['changes'])==1
    assert len(a.get('/api/history/animals/animal_a').json['history'])==1
    assert push(a,h,[op(animal(name='different'))]).status_code==409


def test_two_users_same_revision_and_history(app):
    a,ah=login(app); b,bh=login(app,'suzanna')
    assert push(a,ah,[op(animal())]).status_code==200
    assert len(b.get('/api/changes').json['changes'])==1
    assert push(a,ah,[op(animal(notes='Alice'),1,'op_edit_a')]).status_code==200
    response=push(b,bh,[op(animal(notes='Suzanna'),1,'op_edit_b')])
    assert response.status_code==409
    assert response.json['current']['notes']=='Alice'
    assert response.json['code']=='revision_conflict'
    assert len(b.get('/api/history/animals/animal_a').json['history'])==2


def test_concurrent_writers_only_one_wins(app):
    store=app.config['STORE'];actor={'id':'alice','role':'admin'}
    apply_operations(store,actor,[op(animal())])
    def write(n):
        try:
            apply_operations(store,{'id':'alice' if n==0 else 'suzanna','role':'editor'},[op(animal(notes=str(n)),1,'race_'+str(n))])
            return 200
        except Rejected as e:
            return e.status
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(write,range(2)))==[200,409]


def test_batch_rollback_duplicates_and_cycles(app):
    a,h=login(app)
    response=push(a,h,[op(animal()),op(animal('animal_b'),0,'op_b')])
    assert response.status_code==409
    assert a.get('/api/changes').json['changes']==[]
    assert push(a,h,[op(animal(motherTag='FR0000000001'))]).status_code==422
    assert push(a,h,[op(animal()),op(animal('animal_b','FR0000000002',motherTag='FR0000000001',birthDate='2026-01-01'),0,'op_b')]).status_code==200
    assert push(a,h,[op(animal(motherTag='FR0000000002'),1,'cycle')]).status_code==422


def test_sales_receipt_never_claims_windows(app):
    a,h=login(app)
    sale={'id':'sale_a','date':'2026-11-14','lines':[{'product':'Test','quantityMilli':333,'unitPriceCents':505,'totalCents':168,'vatRate':5.5}],'syncState':'synced','windowsReceipt':{'fake':True}}
    response=push(a,h,[op(sale,kind='sales')])
    assert response.status_code==200
    data=response.json['receipts'][0]['data']
    assert data['syncState']=='pending' and 'windowsReceipt' not in data
    assert data['lines'][0]['netCents']+data['lines'][0]['vatCents']==168
    bad=copy.deepcopy(sale);bad['lines'][0]['totalCents']=169
    assert push(a,h,[op(bad,1,'bad_sale','sales')]).status_code==422
    cancel={**sale,'cancelled':True}
    assert push(a,h,[op(cancel,1,'cancel','sales')]).status_code==200
    assert len(a.get('/api/history/sales/sale_a').json['history'])==2


def test_undated_history_and_validation(app):
    a,h=login(app);push(a,h,[op(animal())])
    event={'id':'event_a','animalId':'animal_a','type':'Observation','date':'','dateUnknown':True,'description':'Date source inconnue'}
    assert push(a,h,[op(event,id='event_op',kind='events')]).status_code==200
    assert push(a,h,[op(animal(birthDate='2025-02-30'),1,'date')]).status_code==422
    assert push(a,h,[op(animal(status='sorti'),1,'exit')]).status_code==422


def test_login_rate_limit_revocation_and_backup(app):
    c=app.test_client()
    for _ in range(10):
        assert c.post('/api/login',json={'username':'missing','password':'bad'}).status_code==401
    assert c.post('/api/login',json={'username':'missing','password':'bad'}).status_code==429
    # IP lock intentionally applies across account names.
    assert c.post('/api/login',json={'username':'alice','password':'a-long-test-password'}).status_code==429


def test_logout_and_cursor(app):
    a,h=login(app)
    push(a,h,[op(animal())])
    result=a.get('/api/changes').json
    assert a.get('/api/changes?after='+str(result['cursor'])).json['changes']==[]
    assert a.get('/api/export').json['kind']=='central-backup'
    assert a.post('/api/logout',headers=h,json={}).status_code==200
    assert a.get('/api/changes').status_code==401


def test_persistent_session_survives_app_restart_and_expires_without_password_storage(app,monkeypatch):
    from server.app import SESSION_LIFETIME
    import hashlib
    a,h=login(app)
    cookie=a.get_cookie('tb_session')
    assert cookie.http_only and cookie.same_site=='Strict'
    assert cookie.max_age==SESSION_LIFETIME==30*86400
    # A new app process reads the durable session, not a browser password.
    restarted=create_app(app.config['STORE'].url,testing=True)
    client=restarted.test_client();client.set_cookie('tb_session',cookie.value)
    assert client.get('/api/session').status_code==200
    token_hash=hashlib.sha256(cookie.value.encode()).hexdigest()
    with restarted.config['STORE'].transaction(write=True) as db:
        row=db.execute('SELECT * FROM sessions WHERE token=?',(token_hash,)).fetchone()
        assert row and row['token']!=cookie.value
        db.execute('UPDATE sessions SET expires=? WHERE token=?',(int(__import__('time').time())+86400,token_hash))
    renewed=client.get('/api/session')
    assert renewed.status_code==200
    assert 'HttpOnly' in renewed.headers['Set-Cookie']
    assert client.get('/api/session').headers.get('Set-Cookie') is None
    with restarted.config['STORE'].transaction(write=True) as db:
        db.execute('UPDATE sessions SET expires=0 WHERE token=?',(token_hash,))
    assert client.get('/api/session').status_code==401


def pin_account(app, code='0785'):
    from server.app import PIN_HASH_PREFIX
    with app.config['STORE'].transaction(write=True) as db:
        db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)',('pin-test','Synthetic PIN user',PIN_HASH_PREFIX+generate_password_hash(code,method='scrypt'),'editor'))


def test_personal_pin_keeps_leading_zero_and_password_accounts(app):
    pin_account(app)
    client=app.test_client()
    assert client.post('/api/login',json={'username':'pin-test','password':'785'}).status_code==401
    response=client.post('/api/login',json={'username':'pin-test','password':'0785'})
    assert response.status_code==200 and response.json['user']['id']=='pin-test'
    assert 'HttpOnly' in response.headers['Set-Cookie']
    assert client.get('/api/session').status_code==200
    old,headers=login(app)
    assert old.get('/api/session').status_code==200


def test_personal_pin_lock_survives_new_ips_time_and_server_restart(app,monkeypatch):
    import time
    pin_account(app)
    client=app.test_client()
    for index in range(5):
        assert client.post('/api/login',json={'username':'pin-test','password':'9999'},environ_overrides={'REMOTE_ADDR':'192.0.2.'+str(index+1)}).status_code==401
    later=int(time.time())+31*86400
    monkeypatch.setattr('server.app.time.time',lambda:later)
    restarted=create_app(app.config['STORE'].url,testing=True)
    assert restarted.test_client().post('/api/login',json={'username':'pin-test','password':'0785'},environ_overrides={'REMOTE_ADDR':'192.0.2.200'}).status_code==429
    import hashlib
    with restarted.config['STORE'].transaction(write=True) as db:
        db.execute('DELETE FROM login_attempts WHERE key=?',(hashlib.sha256(b'account:pin-test').hexdigest(),))
    assert restarted.test_client().post('/api/login',json={'username':'pin-test','password':'0785'}).status_code==200


def test_personal_pin_format_never_accepts_a_long_secret(app):
    pin_account(app,'12345')
    assert app.test_client().post('/api/login',json={'username':'pin-test','password':'12345'}).status_code==401


def test_fail_closed_without_database(monkeypatch):
    monkeypatch.delenv('DATABASE_URL',raising=False)
    app=create_app(testing=True);c=app.test_client()
    assert c.get('/healthz').json['databaseConfigured'] is False
    assert c.get('/api/session').status_code==503
    assert c.get('/').status_code==200


def test_render_refuses_ephemeral_sqlite(monkeypatch,tmp_path):
    monkeypatch.setenv('RENDER','true')
    with pytest.raises(RuntimeError):
        create_app(str(tmp_path/'ephemeral.db'),testing=True)


def test_controlled_restore_preserves_receipts_and_history(app,tmp_path):
    from server.backup import snapshot, restore_empty
    from server.store import Store
    a,h=login(app);payload=[op(animal())];receipt=push(a,h,payload).json['receipts']
    data=snapshot(app.config['STORE']);destination=Store(str(tmp_path/'restore.db'));destination.initialize()
    restore_empty(destination,data)
    assert apply_operations(destination,{'id':'alice','role':'admin'},payload)==receipt
    with pytest.raises(ValueError):restore_empty(destination,data)
    with destination.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM changes').fetchone()['n']==1


def test_sale_twenty_replays_and_reentry_keep_one_identity(app):
    a,h=login(app)
    sale={'id':'sale_twenty','date':'2026-11-14','lines':[{'product':'Test','quantityMilli':2000,'unitPriceCents':500,'totalCents':1000,'vatRate':None}]}
    payload=[op(sale,id='twenty',kind='sales')]
    receipts=[push(a,h,payload).json for _ in range(20)]
    assert all(r==receipts[0] for r in receipts)
    push(a,h,[op(animal())])
    assert push(a,h,[op(animal(status='sorti',exitDate='2026-01-01'),1,'exit_1')]).status_code==200
    assert push(a,h,[op(animal(status='present',exitDate=''),2,'reentry_1')]).status_code==200
    history=a.get('/api/history/animals/animal_a').json['history']
    assert len(history)==3 and history[1]['exitDate']=='2026-01-01'
    assert len(a.get('/api/history/sales/sale_twenty').json['history'])==1


def test_malformed_json_is_rejected(app):
    a,h=login(app)
    assert a.post('/api/sync',json=['wrong'],headers=h).status_code==422
    assert push(a,h,[{**op(animal()),'data':['wrong']}]).status_code==422
    assert push(a,h,[op(animal(notes=float('nan')))]).status_code==422
