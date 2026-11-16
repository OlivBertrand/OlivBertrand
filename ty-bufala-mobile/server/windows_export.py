"""Sales-only staging snapshot. It is NEVER an acknowledgement of Windows import."""
from .store import utcnow


def sales_snapshot(store):
    with store.transaction() as db:
        rows = db.execute("SELECT kind,id,revision,data,author,device_id,changed_at FROM records WHERE kind='sales' ORDER BY id").fetchall()
    return {'application': 'ty-bufala-mobile', 'kind': 'windows-staging', 'formatVersion': 1,
            'salesComplete': True, 'exportedAt': utcnow(), 'windowsIntegrated': False,
            'records': [dict(row) for row in rows]}
