import copy
import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from staging import WindowsSaleLedger, StagingError, SOURCE


def sale(sid='sale_a', cancelled=False, price=200):
    return {'id':sid,'date':'2026-11-15','cancelled':cancelled,'syncState':'pending',
            'lines':[{'product':'Mozzarella','quantityMilli':1500,'unitPriceCents':price,'totalCents':(1500*price+500)//1000,'vatRate':5.5}],
            'totalCents':(1500*price+500)//1000}


def snapshot(*items):
    return {'application':'ty-bufala-mobile','formatVersion':2,'kind':'central-backup',
            'exportedAt':'2026-11-15T10:00:00Z','complete':True,'records':[
                {'kind':'sales','id':s['id'],'revision':r,'data':json.dumps(s,ensure_ascii=False)} for s,r in items]}


def ledger(tmp_path):
    return WindowsSaleLedger(tmp_path/'private-ledger.db')


def test_first_import_and_replay(tmp_path):
    l=ledger(tmp_path)
    pack=snapshot((sale(),1),(sale('sale_b'),1))
    assert l.stage_snapshot(pack)['staged']==2
    assert l.stage_snapshot(pack)['replayed']
    assert l.summary()['states']['pending']==2
    assert len(l.pending())==2


def test_same_sale_newer_revision_supersedes_old(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),1)))
    r=l.stage_snapshot(snapshot((sale(price=300),2)))
    assert r['staged']==1
    assert l.summary()['states']['superseded']==1
    assert [x['revision'] for x in l.pending()]==[2]


def test_old_snapshot_cannot_resurrect_old_revision(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),2)))
    r=l.stage_snapshot(snapshot((sale(price=300),1)))
    assert r['stale']==1
    assert l.summary()['states']['pending']==1


def test_cancel_before_any_windows_commit(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),1)))
    l.stage_snapshot(snapshot((sale(cancelled=True),2)))
    assert l.summary()['states']['ignored_cancelled']==1
    assert not l.pending()


def test_no_windows_receipt_without_proof(tmp_path):
    l=ledger(tmp_path)
    s=sale()
    l.stage_snapshot(snapshot((s,1)))
    with pytest.raises(StagingError):l.record_verified_windows_commit('sale_a',1,None)
    with pytest.raises(StagingError):l.record_verified_windows_commit('sale_a',1,lambda *a: None)
    with pytest.raises(StagingError):l.record_verified_windows_commit('sale_a',1,lambda *a: {'sale_id':'sale_a','revision':1,'windows_reference':'M1','content_hash':'fake'})
    assert l.summary()['receipts']==0


def test_verified_marker_receipt_then_correction_requires_review(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),1)))
    proof={'sale_id':'sale_a','revision':1,'windows_reference':'WIN-1001','content_hash':l.pending()[0]['content_hash']}
    check=lambda *a:proof
    assert l.record_verified_windows_commit('sale_a',1,check)=='WIN-1001'
    assert l.record_verified_windows_commit('sale_a',1,check)=='WIN-1001'
    assert l.summary()['receipts']==1
    assert l.stage_snapshot(snapshot((sale(price=250),2)))['review']==1
    assert l.pending()[0]['state']=='requires_review'
    with pytest.raises(StagingError): l.record_verified_windows_commit('sale_a',2,check)


def test_same_revision_changed_fingerprint_fails_and_is_atomic(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),1)))
    with pytest.raises(StagingError):
        l.stage_snapshot(snapshot((sale('sale_b'),1),(sale(price=300),1)))
    assert l.summary()['states']['pending']==1
    assert l.summary()['snapshots']==1


def test_malformed_second_record_rolls_back_all(tmp_path):
    l=ledger(tmp_path)
    bad=sale('sale_bad');bad['lines'][0]['totalCents']+=1
    with pytest.raises(StagingError):l.stage_snapshot(snapshot((sale(),1),(bad,1)))
    assert l.summary()['snapshots']==0
    assert not l.pending()


def test_float_quantities_and_wrong_total_refused(tmp_path):
    l=ledger(tmp_path)
    bad=sale();bad['lines'][0]['quantityMilli']=1.5
    with pytest.raises(StagingError):l.stage_snapshot(snapshot((bad,1)))
    bad=sale();bad['totalCents']=5
    with pytest.raises(StagingError):l.stage_snapshot(snapshot((bad,1)))


def test_duplicate_sale_records_rejected(tmp_path):
    l=ledger(tmp_path)
    with pytest.raises(StagingError):l.stage_snapshot(snapshot((sale(),1),(sale(),1)))
    assert l.summary()['snapshots']==0


def test_reference_cannot_be_reused_for_another_sale(tmp_path):
    l=ledger(tmp_path)
    l.stage_snapshot(snapshot((sale(),1),(sale('sale_b'),1)))
    all_rows=l.pending()
    for row in all_rows:
        proof={'sale_id':row['sale_id'],'revision':1,'windows_reference':'WIN-1001','content_hash':row['content_hash']}
        if row['sale_id']=='sale_a': l.record_verified_windows_commit(row['sale_id'],1,lambda *a:proof)
        else:
            with pytest.raises(sqlite3.IntegrityError):l.record_verified_windows_commit(row['sale_id'],1,lambda *a:proof)
    assert l.summary()['receipts']==1


def test_reopen_ledger_preserves_exactly_once(tmp_path):
    path=tmp_path/'ledger.db'
    l=WindowsSaleLedger(path)
    pack=snapshot((sale(),1))
    l.stage_snapshot(pack)
    del l
    assert WindowsSaleLedger(path).stage_snapshot(pack)['replayed']
    assert WindowsSaleLedger(path).summary()['states']['pending']==1


def test_partial_backup_rejected(tmp_path):
    l=ledger(tmp_path)
    p=snapshot((sale(),1)); p['complete']=False
    with pytest.raises(StagingError):l.stage_snapshot(p)
    assert l.summary()['snapshots']==0