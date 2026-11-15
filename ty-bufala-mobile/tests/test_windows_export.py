import pytest
from werkzeug.security import generate_password_hash
from server.app import create_app
from server.domain import apply_operations
from server.windows_export import sales_snapshot
from tools.windows_staging import WindowsSaleLedger, StagingError


@pytest.fixture
def prepared(tmp_path):
    app=create_app(str(tmp_path/'shared.db'),testing=True)
    store=app.config['STORE']
    with store.transaction(write=True) as db:
        for name,role in [('admin','admin'),('editor','editor')]:
            db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)',
                       (name,name,generate_password_hash('synthetic-password'),role))
    actor={'id':'admin','role':'admin'}
    animal={'id':'animal_test','earTag':'FR0000000001','sex':'F','status':'present','notes':'PRIVATE_HERD'}
    sale={'id':'sale:mobile:1','date':'2026-11-15','cancelled':False,
          'lines':[{'product':'Synthetic cheese','quantityMilli':1500,'unitPriceCents':101,'totalCents':152,'vatRate':5.5}]}
    def op(kind,data,revision=0,id='initial'):
        return {'opId':id,'deviceId':'test_device','kind':kind,'baseRevision':revision,'data':data}
    apply_operations(store,actor,[op('animals',animal,id='herd'),op('sales',sale,id='sale')])
    return app,store,actor,sale,op


def test_scoped_export_twenty_transmissions_no_receipt(prepared,tmp_path):
    app,store,actor,sale,op=prepared
    ledger=WindowsSaleLedger(tmp_path/'staging.db')
    for _ in range(20):
        pack=sales_snapshot(store)
        assert len(pack['records'])==1 and pack['records'][0]['kind']=='sales'
        assert 'PRIVATE_HERD' not in str(pack) and 'imports' not in pack and 'users' not in pack
        ledger.stage_snapshot(pack)
    assert len(ledger.pending())==1
    assert ledger.summary()['receipts']==0
    assert ledger.pending()[0]['sale']['syncState']=='pending'
    assert ledger.pending()[0]['sale']['totalCents']==152
    apply_operations(store,actor,[op('sales',{**sale,'cancelled':True},1,'cancel_sale')])
    ledger.stage_snapshot(sales_snapshot(store))
    assert ledger.summary()['states']['ignored_cancelled']==1
    assert not ledger.pending()


def test_scoped_endpoint_admin_only(prepared):
    app,store,actor,sale,op=prepared
    c=app.test_client()
    assert c.get('/api/windows-staging').status_code==401
    assert c.post('/api/login',json={'username':'editor','password':'synthetic-password'}).status_code==200
    assert c.get('/api/windows-staging').status_code==403
    assert c.post('/api/login',json={'username':'admin','password':'synthetic-password'}).status_code==200
    r=c.get('/api/windows-staging')
    assert r.status_code==200 and r.json['windowsIntegrated'] is False
    assert r.headers['Cache-Control']=='no-store'
    assert c.get('/tools/windows_staging.py').status_code==404


def test_verified_receipt_rechecks_marker_identity(prepared,tmp_path):
    app,store,actor,sale,op=prepared
    ledger=WindowsSaleLedger(tmp_path/'staging.db')
    ledger.stage_snapshot(sales_snapshot(store));entry=ledger.pending()[0]
    marker={'sale_id':entry['sale_id'],'revision':entry['revision'],'content_hash':entry['content_hash'],'windows_reference':'WIN-TEST'}
    ledger.record_verified_windows_commit(entry['sale_id'],entry['revision'],lambda *args:marker)
    wrong={**marker,'sale_id':'other_sale'}
    with pytest.raises(StagingError):
        ledger.record_verified_windows_commit(entry['sale_id'],entry['revision'],lambda *args:wrong)
