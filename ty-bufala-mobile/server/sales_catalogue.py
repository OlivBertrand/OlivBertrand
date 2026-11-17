"""Read-only phone catalogue, published by the Windows administrator."""
import hashlib
import json
import re
from .store import canonical
from .domain import Rejected, public_record

FAMILIES = ('MOZARELLA','SCAMORZA','TOMME','YAOURTS','RIZ AU LAIT','DESSERTS','VENTES DE BUFFLONS (VIANDE)','Divers')


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def read_catalogue(db):
    row=db.execute("SELECT value FROM metadata WHERE key='sales_catalogue'").fetchone()
    return json.loads(row['value']) if row else {'version':None,'sourceId':None,'products':[]}


def publish(store, value):
    if not isinstance(value,dict) or set(value)!={'version','sourceId','products'}:
        raise Rejected('Catalogue invalide.')
    if not isinstance(value['sourceId'],str) or not re.fullmatch(r'windows_[a-f0-9]{32}',value['sourceId']):
        raise Rejected('Identité Windows invalide.')
    products=value['products']
    if not isinstance(products,list) or len(products)>5000:raise Rejected('Catalogue trop volumineux.')
    identifiers=set()
    for p in products:
        if not isinstance(p,dict) or set(p)!={'id','productId','itemCode','name','unit','vatRate','cashFamily','unitPriceCents','bleezCode','categoryId','ready'}:
            raise Rejected('Fiche produit invalide.')
        if not isinstance(p['id'],str) or not re.fullmatch(r'(PRODUCT:[0-9]+|CATALOG:[A-Za-z0-9_.-]{1,120})',p['id']) or p['id'] in identifiers:
            raise Rejected('Référence produit invalide ou dupliquée.')
        identifiers.add(p['id'])
        if type(p['productId']) is not int or p['productId']<1 or not isinstance(p['name'],str) or not 1<=len(p['name'])<=180:
            raise Rejected('Produit Windows invalide.')
        if p['unit'] not in ('pièce','kg') or p['vatRate'] not in (None,0,2.1,5.5,10,20) or type(p['vatRate']) is bool:
            raise Rejected('Unité ou TVA invalide.')
        if p['cashFamily'] not in (None,*FAMILIES) or type(p['ready']) is not bool or p['ready']!=(p['vatRate'] is not None and p['cashFamily'] in FAMILIES):
            raise Rejected('Affectation caisse Bleez invalide.')
        if p['unitPriceCents'] is not None and (type(p['unitPriceCents']) is not int or not 0<=p['unitPriceCents']<=10**9):
            raise Rejected('Prix catalogue invalide.')
        if not isinstance(p['bleezCode'],str) or len(p['bleezCode'])>120 or p['categoryId'] is not None and type(p['categoryId']) is not int:
            raise Rejected('Classement produit invalide.')
        if p['itemCode'] is not None and (not isinstance(p['itemCode'],str) or p['id']!='CATALOG:'+p['itemCode']):
            raise Rejected('Référence catalogue contradictoire.')
        if p['itemCode'] is None and p['id']!='PRODUCT:'+str(p['productId']):raise Rejected('Référence produit contradictoire.')
    body={'sourceId':value['sourceId'],'products':sorted(products,key=lambda p:p['id'])}
    if value['version']!=fingerprint(body):raise Rejected('Empreinte catalogue invalide.')
    with store.transaction() as db:
        old=read_catalogue(db)
        if old['sourceId'] and old['sourceId']!=value['sourceId']:
            raise Rejected('Catalogue lié à une autre installation Windows.',409)
        if old['version']==value['version']:return old
    with store.transaction(write=True) as db:
        store.lock(db);old=read_catalogue(db)
        if old['sourceId'] and old['sourceId']!=value['sourceId']:
            raise Rejected('Catalogue lié à une autre installation Windows.',409)
        if old['version']==value['version']:return old
        for key in ('sales_catalogue','sales_catalogue:'+value['version']):
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,canonical(value)))
    return value


def bind_line(db,line):
    """Legacy free text remains readable; new catalogue references are verified."""
    if not any(key in line for key in ('catalogueVersion','catalogueId','productId')):return
    version=line.get('catalogueVersion')
    if not isinstance(version,str) or not re.fullmatch('[a-f0-9]{64}',version):raise Rejected('Catalogue source manquant.')
    row=db.execute('SELECT value FROM metadata WHERE key=?',('sales_catalogue:'+version,)).fetchone()
    if not row:raise Rejected('Catalogue source inconnu. Synchroniser la liste des produits.')
    catalogue=json.loads(row['value']);entry=next((p for p in catalogue['products'] if p['id']==line.get('catalogueId')),None)
    if not entry or not entry['ready']:raise Rejected('Produit non prêt : compléter sa TVA et son classement dans Windows.')
    if type(line.get('productId')) is not int or type(line.get('vatRate')) is bool:raise Rejected('Référence ou taux de TVA invalide.')
    if line.get('catalogueSource')!=catalogue['sourceId'] or any(line.get(k)!=entry[v] for k,v in (('productId','productId'),('product','name'),('vatRate','vatRate'),('unit','unit'))):
        raise Rejected('Référence produit ou TVA différente du catalogue Windows.')
    line['cashFamily']=entry['cashFamily']


def read_receipts(db):
    return [json.loads(r['value']) for r in db.execute("SELECT value FROM metadata WHERE key LIKE 'sales_receipt:%' ORDER BY key").fetchall()]


def acknowledge(store,value):
    if not isinstance(value,dict) or set(value)!={'sourceId','receipts'} or not isinstance(value['receipts'],list) or not 1<=len(value['receipts'])<=100:
        raise Rejected('Accusés Windows invalides.')
    with store.transaction() as db:
        if read_catalogue(db)['sourceId']!=value['sourceId']:raise Rejected('Installation Windows différente.',409)
        unchanged=True
        for receipt in value['receipts']:
            if not isinstance(receipt,dict) or set(receipt)!={'id','revision','fingerprint','cashSaleId','status'}:raise Rejected('Accusé Windows incomplet.')
            old=db.execute('SELECT value FROM metadata WHERE key=?',('sales_receipt:'+str(receipt['id']),)).fetchone()
            row=db.execute("SELECT * FROM records WHERE kind='sales' AND id=?",(receipt['id'],)).fetchone()
            if not row or receipt['revision']!=row['revision'] or receipt['fingerprint']!=fingerprint(public_record(row)):
                raise Rejected('Vente modifiée depuis sa réception Windows : accusé périmé.',409)
            if not old or json.loads(old['value'])!=receipt:unchanged=False
        if unchanged:return {'accepted':len(value['receipts'])}
    with store.transaction(write=True) as db:
        store.lock(db)
        if read_catalogue(db)['sourceId']!=value['sourceId']:raise Rejected('Installation Windows différente.',409)
        for receipt in value['receipts']:
            if not isinstance(receipt,dict) or set(receipt)!={'id','revision','fingerprint','cashSaleId','status'}:raise Rejected('Accusé Windows incomplet.')
            row=db.execute("SELECT * FROM records WHERE kind='sales' AND id=?",(receipt['id'],)).fetchone()
            if not row:raise Rejected('Vente inconnue.',409)
            record=public_record(row)
            if receipt['revision']!=record['revision'] or receipt['fingerprint']!=fingerprint(record):
                raise Rejected('Vente modifiée depuis sa réception Windows : accusé périmé.',409)
            expected='cancelled' if record.get('cancelled') else 'integrated'
            if receipt['status']!=expected or (receipt['cashSaleId'] is not None and (type(receipt['cashSaleId']) is not int or receipt['cashSaleId']<1)) or expected=='integrated' and receipt['cashSaleId'] is None:
                raise Rejected('État de réception Windows incohérent.')
            db.execute('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('sales_receipt:'+receipt['id'],canonical(receipt)))
    return {'accepted':len(value['receipts'])}
