import hashlib
import secrets
import time
from urllib.parse import urlsplit

from flask import Blueprint, abort, current_app, g, redirect, render_template, request, session, url_for
from werkzeug.exceptions import SecurityError
from werkzeug.security import check_password_hash, generate_password_hash

from .db import audit, get_db

bp = Blueprint('auth', __name__)
DUMMY_HASH = generate_password_hash('not-a-real-operator-password')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def now():
    return int(time.time())


def safe_next(value):
    value = value or '/terminal.asp'
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not value.startswith('/') or value.startswith('//') or '\\' in value:
        return '/terminal.asp'
    if parsed.path not in {'/terminal.asp', '/screen.asp', '/accounts.asp', '/account.asp', '/review.asp', '/authorize.asp', '/operators.asp'}:
        return '/terminal.asp'
    return value


def csrf_token():
    if getattr(g, 'auth_session', None):
        return g.auth_session['csrf']
    if getattr(g, 'refresh_session', None):
        return g.refresh_session['csrf']
    if 'preauth_csrf' not in session:
        session['preauth_csrf'] = secrets.token_urlsafe(32)
    return session['preauth_csrf']


def refresh_session():
    token = request.cookies.get(current_app.config['REFRESH_COOKIE_NAME'], '')
    if not token:
        return None
    return get_db().execute('''SELECT s.*, r.used_at, r.expires_at AS refresh_expires
        FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id
        WHERE r.token_hash=?''', (digest(token),)).fetchone()


def valid_refresh(row):
    return row and not row['revoked'] and row['expires_at'] > now() and row['refresh_expires'] > now() and row['last_seen'] + current_app.config['IDLE_TTL'] > now()


def guard():
    # Host validation happens during routing, before an URL adapter exists.
    if isinstance(request.routing_exception, SecurityError):
        return '<!doctype html><title>Rejected host</title><p>SEC-02: Host is not permitted.</p>', 400
    g.user = None
    g.auth_session = None
    g.refresh_session = None
    if request.endpoint == 'static':
        return
    token = request.cookies.get(current_app.config['ACCESS_COOKIE_NAME'], '')
    if token:
        row = get_db().execute('SELECT * FROM sessions WHERE access_hash=?', (digest(token),)).fetchone()
        if row and not row['revoked'] and row['access_expires'] > now() and row['expires_at'] > now() and row['last_seen'] + current_app.config['IDLE_TTL'] > now():
            g.auth_session = row
            g.user = get_db().execute('SELECT * FROM users WHERE id=?', (row['user_id'],)).fetchone()
            get_db().execute('UPDATE sessions SET last_seen=? WHERE id=?', (now(), row['id']))
            get_db().commit()
    if request.endpoint in {'auth.renew', 'auth.signoff'}:
        g.refresh_session = refresh_session()
    public = request.endpoint in {'auth.signon', 'auth.renew', 'auth.signoff'}
    if not g.user and not public:
        target = safe_next(request.full_path.rstrip('?'))
        row = refresh_session()
        if valid_refresh(row) and row['used_at'] is None:
            return redirect(url_for('auth.renew', next=target))
        return redirect(url_for('auth.signon', next=target))
    if request.method == 'POST':
        origin = request.headers.get('Origin')
        if origin and origin != request.host_url.rstrip('/'):
            abort(403, 'SEC-03: Cross-origin submission rejected.')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            abort(403, 'SEC-03: Cross-site submission rejected.')
        supplied = request.form.get('_ticket', '')
        expected = csrf_token()
        if not supplied or not secrets.compare_digest(supplied, expected):
            abort(400, 'SEC-01: This form has expired. Reload the screen before trying again.')


def verify_operator(username, password):
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username=?', (username[:64],)).fetchone()
    if user and user['locked_until'] > now():
        return None
    correct = check_password_hash(user['password_hash'] if user else DUMMY_HASH, password[:256])
    if not user or not correct:
        if user:
            failures = user['failed_attempts'] + 1
            db.execute('UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?',
                       (failures, now() + 300 if failures >= 5 else 0, user['id']))
            audit('SIGNON_REJECTED', user_id=user['id'])
            db.commit()
        return None
    db.execute('UPDATE users SET failed_attempts=0,locked_until=0 WHERE id=?', (user['id'],))
    db.commit()
    return user


def set_tokens(response, access, refresh):
    opts = dict(httponly=True, samesite='Strict', secure=current_app.config['COOKIE_SECURE'], path='/')
    response.set_cookie(current_app.config['ACCESS_COOKIE_NAME'], access, max_age=current_app.config['ACCESS_TTL'], **opts)
    response.set_cookie(current_app.config['REFRESH_COOKIE_NAME'], refresh, max_age=current_app.config['REFRESH_TTL'], **opts)
    return response


def clear_tokens(response):
    response.delete_cookie(current_app.config['ACCESS_COOKIE_NAME'], path='/')
    response.delete_cookie(current_app.config['REFRESH_COOKIE_NAME'], path='/')
    return response


@bp.route('/signon.asp', methods=['GET', 'POST'])
def signon():
    error = None
    target = safe_next(request.values.get('next'))
    if request.method == 'POST':
        user = verify_operator(request.form.get('operator', '').strip(), request.form.get('password', ''))
        if user:
            db = get_db()
            old = refresh_session()
            if old:
                db.execute('UPDATE sessions SET revoked=1 WHERE id=?', (old['id'],))
            access, refresh, sid = (secrets.token_urlsafe(32) for _ in range(3))
            db.execute('''INSERT INTO sessions(id,user_id,access_hash,access_expires,csrf,created_at,last_seen,expires_at)
                          VALUES (?,?,?,?,?,?,?,?)''',
                       (sid, user['id'], digest(access), now()+current_app.config['ACCESS_TTL'],
                        secrets.token_urlsafe(32), now(), now(), now()+current_app.config['REFRESH_TTL']))
            db.execute('INSERT INTO refresh_tokens VALUES (?,?,?,NULL)',
                       (digest(refresh), sid, now()+current_app.config['REFRESH_TTL']))
            audit('SIGNON', user_id=user['id'])
            db.commit()
            session.clear()
            response = redirect(url_for('portal.terminal', resume=target))
            return set_tokens(response, access, refresh)
        error = 'SEC-11: Operator ID or password rejected, or operator temporarily locked. After five failures wait five minutes.'
    return render_template('signon.html', error=error, target=target), 401 if error else 200


@bp.route('/renew.asp', methods=['GET', 'POST'])
def renew():
    row = g.refresh_session
    target = safe_next(request.values.get('next'))
    if not valid_refresh(row):
        return clear_tokens(redirect(url_for('auth.signon', next=target)))
    if request.method == 'POST':
        db = get_db()
        db.execute('BEGIN IMMEDIATE')
        row = refresh_session()
        if not valid_refresh(row):
            db.rollback()
            return clear_tokens(redirect(url_for('auth.signon', next=target)))
        if row['used_at'] is not None:
            db.execute('UPDATE sessions SET revoked=1 WHERE id=?', (row['id'],))
            audit('REFRESH_REUSE_REVOKED', user_id=row['user_id'])
            db.commit()
            return clear_tokens(redirect(url_for('auth.signon', next=target)))
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.execute('UPDATE refresh_tokens SET used_at=? WHERE token_hash=?',
                   (now(), digest(request.cookies[current_app.config['REFRESH_COOKIE_NAME']])))
        db.execute('INSERT INTO refresh_tokens VALUES (?,?,?,NULL)',
                   (digest(refresh), row['id'], row['expires_at']))
        db.execute('UPDATE sessions SET access_hash=?,access_expires=?,last_seen=? WHERE id=?',
                   (digest(access), now()+current_app.config['ACCESS_TTL'], now(), row['id']))
        audit('SESSION_RENEWED', user_id=row['user_id'])
        db.commit()
        return set_tokens(redirect(url_for('portal.terminal', resume=target)), access, refresh)
    return render_template('renew.html', target=target)


@bp.post('/signoff.asp')
def signoff():
    db = get_db()
    active = g.auth_session or g.refresh_session
    if active:
        db.execute('UPDATE sessions SET revoked=1 WHERE id=?', (active['id'],))
        audit('SIGNOFF', user_id=active['user_id'])
        db.commit()
    session.clear()
    return clear_tokens(redirect(url_for('auth.signon')))
