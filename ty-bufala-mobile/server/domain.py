"""Version checks and veterinary/business data validation; no inferred medical facts."""
import hashlib
import re
from datetime import date
from .store import canonical, utcnow

KINDS = ('animals', 'events', 'sales')


class Rejected(Exception):
    def __init__(self, message, status=422, **details):
        self.message, self.status, self.details = message, status, details


def tag(value):
    return re.sub(r'\s+', '', str(value or '')).upper()


def valid_date(value, field):
    if value in ('', None):
        return
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError:
        raise Rejected(f'Date invalide : {field}.') from None


def validate(db, kind, data, old):
    if not isinstance(data, dict) or len(canonical(data)) > 200_000:
        raise Rejected('Enregistrement invalide ou trop volumineux.')
    if not isinstance(data.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', data['id']):
        raise Rejected('Identifiant stable manquant ou invalide.')
    for key, value in data.items():
        if key in ('date', 'birthDate', 'lastCalving', 'matingDate', 'expectedCalving', 'weaningDate', 'introducedAt', 'exitDate', 'nextDate', 'treatmentEnd', 'milkUntil', 'meatUntil'):
            valid_date(value, key)
    if kind == 'animals':
        data['earTag'] = tag(data.get('earTag'))
        if not data['earTag'] or len(data['earTag']) > 64:
            raise Rejected('Identification obligatoire.')
        found = db.execute('SELECT animal_id FROM identities WHERE tag=?', (data['earTag'],)).fetchone()
        if found and found['animal_id'] != data['id']:
            raise Rejected('Cette identification appartient déjà à un animal.', 409, code='duplicate_tag')
        if data.get('sex', '') not in ('F', 'M', '') or data.get('status') not in ('present', 'sorti', 'archive'):
            raise Rejected('Sexe ou statut invalide.')
        if data.get('birthDate') and data['birthDate'] > date.today().isoformat():
            raise Rejected('Une naissance future ne peut pas être enregistrée comme réelle.')
        if data.get('exitDate') and data.get('birthDate') and data['exitDate'] < data['birthDate']:
            raise Rejected('La sortie précède la naissance.')
        if data.get('status') == 'sorti' and not data.get('exitDate'):
            raise Rejected('Préciser la date de sortie.')
        if data.get('lastCalving') and data.get('birthDate') and data['lastCalving'] < data['birthDate']:
            raise Rejected('Vêlage antérieur à la naissance de la mère.')
        for relation, expected_sex in [('motherTag', 'F'), ('fatherTag', 'M')]:
            parent_tag = tag(data.get(relation))
            parent = db.execute('SELECT r.data FROM records r JOIN identities i ON i.animal_id=r.id WHERE r.kind=? AND i.tag=?', ('animals', parent_tag)).fetchone() if parent_tag else None
            if parent:
                import json
                p = json.loads(parent['data'])
                if p.get('sex') and p['sex'] != expected_sex:
                    raise Rejected('Sexe du parent incompatible avec la filiation.')
                if p.get('birthDate') and data.get('birthDate') and p['birthDate'] >= data['birthDate']:
                    raise Rejected('Le parent doit être né avant son descendant.')
        # Walk either parent. Unknown/external tags are kept as supplied, never invented.
        parents = {tag(data.get('motherTag')), tag(data.get('fatherTag'))} - {''}
        seen = set()
        while parents:
            parent = parents.pop()
            if parent == data['earTag']:
                raise Rejected('Filiation cyclique interdite.')
            if parent in seen:
                continue
            seen.add(parent)
            row = db.execute('SELECT r.data FROM records r JOIN identities i ON i.animal_id=r.id WHERE r.kind=? AND i.tag=?', ('animals', parent)).fetchone()
            if row:
                import json
                ancestor = json.loads(row['data'])
                parents.update({tag(ancestor.get('motherTag')), tag(ancestor.get('fatherTag'))} - {''})
    elif kind == 'events':
        if not db.execute('SELECT id FROM records WHERE kind=? AND id=?', ('animals', data.get('animalId'))).fetchone():
            raise Rejected('Animal de cet événement introuvable.')
        if not data.get('type'):
            raise Rejected('Type d’événement obligatoire.')
        if not data.get('date') and not data.get('dateUnknown'):
            raise Rejected('Date obligatoire, ou date historique inconnue explicite.')
        for key in ('milkWithdrawalDays', 'meatWithdrawalDays', 'durationDays'):
            if data.get(key) not in ('', None) and (type(data[key]) is not int or data[key] < 0):
                raise Rejected(f'{key} doit être un entier positif ou nul.')
    else:
        if not isinstance(data.get('lines'), list) or not 1 <= len(data['lines']) <= 100:
            raise Rejected('Une vente doit comporter 1 à 100 lignes.')
        if not data.get('date'):
            raise Rejected('Date de vente obligatoire.')
        total = 0
        for line in data['lines']:
            qty, price = line.get('quantityMilli'), line.get('unitPriceCents')
            if type(qty) is not int or type(price) is not int or not 0 < qty <= 10**9 or not 0 <= price <= 10**9:
                raise Rejected('Quantité ou prix invalide.')
            if not isinstance(line.get('product'), str) or not line['product'].strip():
                raise Rejected('Produit obligatoire.')
            amount = (qty * price + 500) // 1000
            if line.get('totalCents') != amount:
                raise Rejected('Total de ligne incohérent.')
            rate = line.get('vatRate')
            if rate not in (None, 0, 2.1, 5.5, 10, 20):
                raise Rejected('Taux de TVA non pris en charge.')
            line['netCents'] = None if rate is None else (amount * 10000 + (10000 + round(rate * 100)) // 2) // (10000 + round(rate * 100))
            line['vatCents'] = None if rate is None else amount - line['netCents']
            total += amount
        if total > 10**12:
            raise Rejected('Montant total trop élevé.')
        data['totalCents'] = total
        # Only a verified Windows bridge may acknowledge integration. None is enabled yet.
        data['syncState'] = 'pending'
        data.pop('windowsReceipt', None)
    if old:
        data['createdAt'] = old.get('createdAt')
        # Source rows/cells are immutable evidence, not editable phone fields.
        for key in ('sourceCells', 'sourceRow', 'sourceDigest', 'source'):
            if key in old:
                data[key] = old[key]


def apply_operations(store, actor, operations, initial_import=None):
    import json
    if actor['role'] not in ('admin', 'editor'):
        raise Rejected('Compte en lecture seule.', 403)
    if not isinstance(operations, list) or not 1 <= len(operations) <= (10000 if initial_import else 100):
        raise Rejected('Lot d’opérations invalide.')
    results = []
    with store.transaction(write=True) as db:
        store.lock(db)
        if initial_import:
            if db.execute('SELECT digest FROM imports WHERE digest=?', (initial_import[0],)).fetchone():
                return []
            if db.execute('SELECT id FROM records LIMIT 1').fetchone():
                raise Rejected('Import initial uniquement sur base vide. Rapprochement requis pour un nouvel inventaire.', 409)
        for op in operations:
            if not isinstance(op, dict) or not isinstance(op.get('opId'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', op['opId']):
                raise Rejected('Identifiant d’opération manquant.')
            try:
                fingerprint = hashlib.sha256(canonical(op).encode()).hexdigest()
            except (TypeError, ValueError):
                raise Rejected('Contenu JSON non pris en charge.') from None
            replay = db.execute('SELECT * FROM operations WHERE id=?', (op['opId'],)).fetchone()
            if replay:
                if replay['user_id'] != actor['id'] or replay['fingerprint'] != fingerprint:
                    raise Rejected('Identifiant d’opération réutilisé avec un contenu différent.', 409, code='operation_reused')
                results.append(json.loads(replay['result']))
                continue
            device = op.get('deviceId')
            if not isinstance(device, str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,160}', device):
                raise Rejected('Identifiant d’appareil nécessaire.')
            db.execute('INSERT INTO devices(id,user_id,last_seen) VALUES (?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET last_seen=excluded.last_seen', (device, actor['id'], utcnow()))
            kind = op.get('kind')
            if kind not in KINDS or type(op.get('baseRevision')) is not int or op['baseRevision'] < 0:
                raise Rejected('Type ou version invalide.')
            if not isinstance(op.get('data'), dict):
                raise Rejected('Contenu de fiche invalide.')
            data = dict(op['data'])
            current = db.execute('SELECT * FROM records WHERE kind=? AND id=?', (kind, data.get('id'))).fetchone()
            revision = current['revision'] if current else 0
            if op['baseRevision'] != revision:
                raise Rejected('Modification concurrente : choisir la version à conserver.', 409,
                               code='revision_conflict', opId=op['opId'], current=public_record(current) if current else None)
            old = json.loads(current['data']) if current else None
            try:
                validate(db, kind, data, old)
            except Rejected as error:
                error.details.update(opId=op['opId'], kind=kind, recordId=data.get('id'))
                raise
            changed_at = utcnow()
            revision += 1
            for key in ('revision', 'author', 'deviceId', 'changedAt', '_sync'):
                data.pop(key, None)
            data['updatedAt'] = changed_at
            if not old:
                data['createdAt'] = data.get('createdAt') or changed_at
            payload = canonical(data)
            db.execute('INSERT INTO records(kind,id,revision,data,author,device_id,changed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,author=excluded.author,device_id=excluded.device_id,changed_at=excluded.changed_at',
                       (kind, data['id'], revision, payload, actor['id'], device, changed_at))
            if kind == 'animals':
                # Keep historical tag aliases reserved, so correcting an ID never duplicates an animal.
                db.execute('INSERT INTO identities(tag,animal_id) VALUES (?,?) ON CONFLICT(tag) DO UPDATE SET animal_id=excluded.animal_id', (data['earTag'], data['id']))
            row = db.execute('INSERT INTO changes(kind,record_id,revision,data,author,device_id,changed_at) VALUES (?,?,?,?,?,?,?) RETURNING seq', (kind, data['id'], revision, payload, actor['id'], device, changed_at)).fetchone()
            result = {'opId': op['opId'], 'kind': kind, 'id': data['id'], 'revision': revision, 'seq': row['seq'], 'data': {**data, 'revision': revision, 'author': actor['id'], 'deviceId': device, 'changedAt': changed_at}}
            db.execute('INSERT INTO operations(id,user_id,fingerprint,result) VALUES (?,?,?,?)', (op['opId'], actor['id'], fingerprint, canonical(result)))
            results.append(result)
        if initial_import:
            db.execute('INSERT INTO imports(digest,source,archive,report,imported_at) VALUES (?,?,?,?,?)', (*initial_import, utcnow()))
    return results


def public_record(row):
    import json
    return {**json.loads(row['data']), 'revision': row['revision'], 'author': row['author'], 'deviceId': row['device_id'], 'changedAt': row['changed_at']}
