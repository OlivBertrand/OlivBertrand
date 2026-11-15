"""Same-origin API and explicit PWA asset allowlist. Never serve repository files."""
import hashlib
import json
import os
import secrets
import time
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit
from flask import Flask, request, jsonify, send_from_directory, g
from werkzeug.security import check_password_hash, generate_password_hash
from .store import Store
from .domain import Rejected, apply_operations, public_record, KINDS

ASSETS = {'index.html', 'styles.css', 'app.js', 'sync.js', 'sw.js', 'manifest.webmanifest',
          'quality.js', 'enhancements.js', 'enhancements.css', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'}
DUMMY_HASH = generate_password_hash('not-a-user-password', method='scrypt')


def create_app(database_url=None, testing=False):
    app = Flask(__name__, static_folder=None)
    app.config.update(TESTING=testing, MAX_CONTENT_LENGTH=4 * 1024 * 1024)
    url = database_url or os.environ.get('DATABASE_URL')
    store = Store(url) if url else None
    if store:
        store.initialize()
    app.config['STORE'] = store
    root = Path(__file__).resolve().parent.parent

    from .onedrive_store import RemoteUnavailable

    @app.errorhandler(RemoteUnavailable)
    def remote_unavailable(error):
        return jsonify(error=str(error), code="remote_storage_unavailable"), 503

    @app.errorhandler(Rejected)
    def rejected(error):
        return jsonify(error=error.message, **error.details), error.status

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store' if request.path.startswith('/api/') else 'no-cache'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if not testing:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.before_request
    def safety():
        if request.path.startswith('/api/') and not store:
            raise Rejected('Base partagée non configurée. Aucune donnée privée n’est disponible.', 503, code='database_unconfigured')
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('Origin')
            expected = os.environ.get('APP_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL') or request.host_url.rstrip('/')
            if not testing and (not origin or origin != expected):
                raise Rejected('Origine de requête refusée.', 403)
            if request.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise Rejected('Requête intersite refusée.', 403)

    def authenticated(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            raw = request.cookies.get('tb_session', '')
            token = hashlib.sha256(raw.encode()).hexdigest()
            with store.transaction() as db:
                row = db.execute('SELECT s.csrf,u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1', (token, int(time.time()))).fetchone()
            if not row:
                raise Rejected('Connexion individuelle nécessaire.', 401)
            if request.method != 'GET' and not secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), row['csrf']):
                raise Rejected('Session à renouveler.', 403)
            g.user = dict(row)
            return function(*args, **kwargs)
        return wrapped

    @app.get('/readyz')
    def ready():
        if not store:
            return jsonify(ready=False, reason='database_unconfigured'), 503
        with store.transaction() as db:
            db.execute('SELECT 1').fetchone()
        return jsonify(ready=True)

    @app.get('/healthz')
    def health():
        return jsonify(service='ty-bufala-mobile', version='0.3', databaseConfigured=bool(store))

    @app.post('/api/login')
    def login():
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            raise Rejected('Objet JSON requis.')
        username, password = str(body.get('username', '')).strip().lower(), str(body.get('password', ''))
        if len(username) > 160 or len(password) > 1024:
            raise Rejected('Identifiants invalides.', 401)
        # Account and remote-address limits survive worker restarts. No shared password.
        keys = [hashlib.sha256(x.encode()).hexdigest() for x in ('account:' + username, 'ip:' + (request.remote_addr or 'unknown'))]
        now = int(time.time())
        with store.transaction(write=True) as db:
            store.lock(db)
            for key in keys:
                attempt = db.execute('SELECT * FROM login_attempts WHERE key=?', (key,)).fetchone()
                if attempt and attempt['failures'] >= 10 and attempt['until_time'] > now:
                    raise Rejected('Trop de tentatives. Réessayer dans 15 minutes.', 429)
            row = db.execute('SELECT * FROM users WHERE id=? AND active=1', (username,)).fetchone()
            valid = check_password_hash(row['password'] if row else DUMMY_HASH, password)
            if not row or not valid:
                for key in keys:
                    old = db.execute('SELECT * FROM login_attempts WHERE key=?', (key,)).fetchone()
                    count = old['failures'] + 1 if old and old['until_time'] > now else 1
                    db.execute('INSERT INTO login_attempts(key,failures,until_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,until_time=excluded.until_time', (key, count, now + 900))
                failed = True
            else:
                failed = False
                for key in keys:
                    db.execute('DELETE FROM login_attempts WHERE key=?', (key,))
                token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
                db.execute('INSERT INTO sessions(token,user_id,csrf,expires) VALUES (?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), username, csrf, now + 7 * 86400))
        if failed:
            raise Rejected('Identifiants invalides.', 401)
        response = jsonify(user={'id': username, 'name': row['name'], 'role': row['role']}, csrf=csrf)
        response.set_cookie('tb_session', token, secure=not testing, httponly=True, samesite='Strict', max_age=7 * 86400, path='/')
        return response

    @app.get('/api/session')
    @authenticated
    def session():
        return jsonify(user={k: g.user[k] for k in ('id', 'name', 'role')}, csrf=g.user['csrf'])

    @app.post('/api/logout')
    @authenticated
    def logout():
        with store.transaction(write=True) as db:
            db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(request.cookies['tb_session'].encode()).hexdigest(),))
        response = jsonify(ok=True)
        response.delete_cookie('tb_session', path='/', secure=not testing, httponly=True, samesite='Strict')
        return response

    @app.get('/api/changes')
    @authenticated
    def changes():
        try:
            after = int(request.args.get('after', '0'))
            if after < 0:
                raise ValueError()
        except ValueError:
            raise Rejected('Curseur invalide.') from None
        with store.transaction() as db:
            rows = db.execute('SELECT * FROM changes WHERE seq>? ORDER BY seq LIMIT 501', (after,)).fetchall()
        result = [{'seq': r['seq'], 'kind': r['kind'], 'data': public_record(r)} for r in rows[:500]]
        return jsonify(changes=result, cursor=result[-1]['seq'] if result else after, hasMore=len(rows) > 500)

    @app.post('/api/sync')
    @authenticated
    def sync():
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            raise Rejected('Objet JSON requis.')
        return jsonify(receipts=apply_operations(store, g.user, body.get('operations')))

    @app.get('/api/inventory-status')
    @authenticated
    def inventory_status():
        with store.transaction() as db:
            rows = db.execute('SELECT digest,source,report,imported_at FROM imports ORDER BY imported_at').fetchall()
        return jsonify(imports=[{**dict(r), 'report': json.loads(r['report'])} for r in rows])

    @app.get('/api/record/<kind>/<record_id>')
    @authenticated
    def record(kind, record_id):
        if kind not in KINDS:
            raise Rejected('Type inconnu.', 404)
        with store.transaction() as db:
            row = db.execute('SELECT * FROM records WHERE kind=? AND id=?', (kind, record_id)).fetchone()
        return jsonify(data=public_record(row) if row else None)

    @app.get('/api/history/<kind>/<record_id>')
    @authenticated
    def history(kind, record_id):
        if kind not in KINDS:
            raise Rejected('Type inconnu.', 404)
        with store.transaction() as db:
            rows = db.execute('SELECT * FROM changes WHERE kind=? AND record_id=? ORDER BY seq', (kind, record_id)).fetchall()
        return jsonify(history=[public_record(r) for r in rows])

    @app.get('/api/export')
    @authenticated
    def export():
        from .backup import snapshot
        return jsonify(snapshot(store, include_archive=g.user['role'] == 'admin'))

    @app.get('/')
    def index():
        return send_from_directory(root, 'index.html')

    @app.get('/<path:name>')
    def asset(name):
        if name not in ASSETS:
            return jsonify(error='Ressource introuvable.'), 404
        return send_from_directory(root, name)

    return app


if __name__ == '__main__':
    create_app().run(host='127.0.0.1', port=8000)
