import copy
from test_api import app,login,op,push
from server.sales_catalogue import fingerprint,publish
from server.backup import snapshot,restore_empty
from server.store import Store


def catalogue():
    body={'sourceId':'windows_'+'a'*32,'products':[{'id':'PRODUCT:1','productId':1,'itemCode':None,'name':'PRODUIT FICTIF',
        'unit':'pièce','vatRate':20,'cashFamily':'Divers','unitPriceCents':12000,'bleezCode':'TEST','categoryId':None,'ready':True}]}
    return {**body,'version':fingerprint(body)}


def sale(catalogue):
    p=catalogue['products'][0]
    return {'id':'sale_catalogue','date':'2026-11-17','channel':'À la ferme','paymentMethod':'Espèces',
        'lines':[{'catalogueId':p['id'],'catalogueVersion':catalogue['version'],'catalogueSource':catalogue['sourceId'],
            'productId':1,'product':p['name'],'unit':p['unit'],'vatRate':20,'quantityMilli':1000,'unitPriceCents':12000,'totalCents':12000}]}


def test_catalogue_auth_roles_integrity_and_single_windows_source(app):
    a,h=login(app);b,bh=login(app,'suzanna');r,rh=login(app,'reader');value=catalogue()
    assert app.test_client().get('/api/sales-catalogue').status_code==401
    assert b.post('/api/sales-catalogue',json=value,headers=bh).status_code==403
    assert a.post('/api/sales-catalogue',json=value).status_code==403
    assert a.post('/api/sales-catalogue',json=value,headers=h).json==value
    assert a.post('/api/sales-catalogue',json=value,headers=h).json==value
    assert r.get('/api/sales-catalogue').json==value
    invalid={**value,'version':'0'*64};assert a.post('/api/sales-catalogue',json=invalid,headers=h).status_code==422
    other={**value,'sourceId':'windows_'+'b'*32};other['version']=fingerprint({k:v for k,v in other.items() if k!='version'})
    assert a.post('/api/sales-catalogue',json=other,headers=h).status_code==409


def test_product_reference_vat_and_archive_for_offline_sale(app):
    a,h=login(app);value=catalogue();publish(app.config['STORE'],value)
    data=sale(value);bad=copy.deepcopy(data);bad['lines'][0]['vatRate']=5.5
    assert push(a,h,[op(bad,id='bad_vat',kind='sales')]).status_code==422
    changed=copy.deepcopy(value);changed['products'][0]['name']='NOUVEAU NOM';changed['version']=fingerprint({k:v for k,v in changed.items() if k!='version'})
    publish(app.config['STORE'],changed)
    response=push(a,h,[op(data,kind='sales')]);assert response.status_code==200
    line=response.json['receipts'][0]['data']['lines'][0]
    assert line['netCents']==10000 and line['vatCents']==2000 and line['cashFamily']=='Divers'


def test_unlinked_amount_catalogue_and_sale_keep_nullable_product_and_exact_vat(app):
    a,h=login(app);value=catalogue();p=value['products'][0]
    p.update(id='CATALOG:viande',productId=None,itemCode='viande',name='VIANDE FICTIVE',unit='vente',inputMode='amount',vatRate=5.5,cashFamily='VENTES DE BUFFLONS (VIANDE)',unitPriceCents=None)
    value['version']=fingerprint({k:v for k,v in value.items() if k!='version'})
    assert a.post('/api/sales-catalogue',json=value,headers=h).status_code==200
    data=sale(value);data['lines'][0].update(productId=None,vatRate=5.5,unitPriceCents=10550,totalCents=10550)
    bad=copy.deepcopy(data);bad['lines'][0].update(quantityMilli=2000,totalCents=21100)
    assert push(a,h,[op(bad,id='bad_amount_quantity',kind='sales')]).status_code==422
    response=push(a,h,[op(data,kind='sales')]);assert response.status_code==200
    line=response.json['receipts'][0]['data']['lines'][0]
    assert line['productId'] is None and line['inputMode']=='amount'
    assert line['netCents']==10000 and line['vatCents']==550


def test_null_product_master_requires_a_real_catalogue_identity(app):
    a,h=login(app);value=catalogue();value['products'][0]['productId']=None
    value['version']=fingerprint({k:v for k,v in value.items() if k!='version'})
    assert a.post('/api/sales-catalogue',json=value,headers=h).status_code==422


def test_receipt_revision_permission_and_complete_restore(app,tmp_path):
    a,h=login(app);b,bh=login(app,'suzanna');value=catalogue();publish(app.config['STORE'],value)
    record=push(a,h,[op(sale(value),kind='sales')]).json['receipts'][0]['data']
    receipt={'id':record['id'],'revision':record['revision'],'fingerprint':fingerprint(record),'cashSaleId':42,'status':'integrated'}
    body={'sourceId':value['sourceId'],'receipts':[receipt]}
    assert b.post('/api/windows-sales-receipts',json=body,headers=bh).status_code==403
    assert a.post('/api/windows-sales-receipts',json=body,headers=h).status_code==200
    assert a.post('/api/windows-sales-receipts',json=body,headers=h).status_code==200
    assert b.get('/api/windows-sales-receipts').json['receipts']==[receipt]
    changed={**record,'notes':'CORRECTION'};assert push(a,h,[op(changed,1,'correction','sales')]).status_code==200
    assert a.post('/api/windows-sales-receipts',json=body,headers=h).status_code==409
    backup=snapshot(app.config['STORE']);target=Store(str(tmp_path/'restored.db'));target.initialize();restore_empty(target,backup)
    restored=snapshot(target)
    for key in ('records','history','operations','identities','salesMetadata'):assert restored[key]==backup[key]
    assert len(restored['salesMetadata'])==3


def test_catalogue_and_receipt_survive_cached_journal_restart_without_empty_writes():
    from test_cached_onedrive_store import FakeGraphJournal
    from server.cached_onedrive_store import CachedJournalStore
    from server.sales_catalogue import acknowledge,read_catalogue,read_receipts
    from server.domain import apply_operations
    remote=FakeGraphJournal();store=CachedJournalStore(remote,allow_empty=True);store.initialize()
    value=catalogue();publish(store,value);count=len(remote.items)
    publish(store,value);assert len(remote.items)==count
    record=apply_operations(store,{'id':'windows','role':'admin'},[op(sale(value),kind='sales')])[0]['data']
    receipt={'id':record['id'],'revision':record['revision'],'fingerprint':fingerprint(record),'cashSaleId':42,'status':'integrated'}
    body={'sourceId':value['sourceId'],'receipts':[receipt]}
    acknowledge(store,body);count=len(remote.items);acknowledge(store,body);assert len(remote.items)==count
    restarted=CachedJournalStore(remote);restarted.initialize()
    with restarted.transaction() as db:
        assert read_catalogue(db)==value
        assert read_receipts(db)==[receipt]
