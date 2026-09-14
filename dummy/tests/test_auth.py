from portal.auth import digest
from portal.db import get_db
from conftest import post, signon, ticket


def test_requires_signon_and_csrf(client):
    assert '/signon.asp' in client.get('/screen.asp?screen=M100').location
    assert client.post('/signon.asp', data={'operator': 'teller', 'password': 'Teller-demo-42!'}).status_code == 400
    signon(client)
    assert client.post('/screen.asp?screen=M100', data={'f01': '12345'}).status_code == 400
    response = post(client, '/screen.asp?screen=M100', {'f01': '12345'}, headers={'Origin': 'https://wrong.example'})
    assert response.status_code == 403
    assert client.get('/screen.asp', headers={'Host': 'evil.example'}).status_code == 400


def test_cookie_and_storage_security(app, client):
    response = signon(client)
    cookies = response.headers.getlist('Set-Cookie')
    for cookie in cookies:
        if cookie.startswith((app.config['ACCESS_COOKIE_NAME']+'=', app.config['REFRESH_COOKIE_NAME']+'=')):
            assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie
    access, refresh = client.get_cookie(client.application.config['ACCESS_COOKIE_NAME']).value, client.get_cookie(client.application.config['REFRESH_COOKIE_NAME']).value
    with app.app_context():
        db = get_db()
        assert db.execute('SELECT access_hash FROM sessions').fetchone()[0] == digest(access)
        assert db.execute('SELECT token_hash FROM refresh_tokens').fetchone()[0] == digest(refresh)
        records = '\n'.join(db.iterdump())
        assert access not in records and refresh not in records and 'Teller-demo-42!' not in records
        assert db.execute('SELECT password_hash FROM users WHERE username="teller"').fetchone()[0].startswith('scrypt:')
    response = client.get('/screen.asp')
    assert response.headers['Cache-Control'] == 'no-store'
    assert "frame-ancestors 'self'" in response.headers['Content-Security-Policy']


def test_refresh_rotation_reuse_revokes_family(app, client):
    signon(client)
    old_refresh = client.get_cookie(client.application.config['REFRESH_COOKIE_NAME']).value
    post(client, '/screen.asp?screen=X990', {'f01': 'access_expired'})
    assert '/renew.asp' in client.get('/screen.asp?screen=M100').location
    renew = post(client, '/renew.asp?next=/screen.asp?screen=M100')
    assert renew.status_code == 302
    new_access = client.get_cookie(client.application.config['ACCESS_COOKIE_NAME']).value
    assert client.get_cookie(client.application.config['REFRESH_COOKIE_NAME']).value != old_refresh
    assert client.get('/screen.asp?screen=M100').status_code == 200
    client.set_cookie(client.application.config['REFRESH_COOKIE_NAME'], old_refresh)
    response = post(client, '/renew.asp')
    assert '/signon.asp' in response.location
    # Even a still-live access token must fail after refresh-token reuse.
    client.set_cookie(client.application.config['ACCESS_COOKIE_NAME'], new_access)
    assert '/signon.asp' in client.get('/screen.asp?screen=M100').location
    with app.app_context():
        assert get_db().execute('SELECT revoked FROM sessions').fetchone()[0] == 1


def test_signoff_and_absolute_expiration(client):
    signon(client)
    old_access = client.get_cookie(client.application.config['ACCESS_COOKIE_NAME']).value
    old_refresh = client.get_cookie(client.application.config['REFRESH_COOKIE_NAME']).value
    post(client, '/signoff.asp', source='/terminal.asp')
    client.set_cookie(client.application.config['ACCESS_COOKIE_NAME'], old_access)
    client.set_cookie(client.application.config['REFRESH_COOKIE_NAME'], old_refresh)
    assert '/signon.asp' in client.get('/screen.asp').location
    signon(client)
    post(client, '/screen.asp?screen=X990', {'f01': 'session_expired'})
    assert '/signon.asp' in client.get('/screen.asp').location
    assert '/signon.asp' in client.get('/renew.asp').location


def test_idle_timeout(app, client):
    signon(client)
    with app.app_context():
        db = get_db()
        db.execute('UPDATE sessions SET last_seen=0')
        db.commit()
    assert '/signon.asp' in client.get('/screen.asp').location
    assert '/signon.asp' in client.get('/renew.asp').location


def test_password_lockout_and_safe_redirect(app, client):
    for _ in range(5):
        response = post(client, '/signon.asp', {'operator': 'teller', 'password': 'wrong'})
        assert response.status_code == 401
    response = post(client, '/signon.asp', {'operator': 'teller', 'password': 'Teller-demo-42!'})
    assert response.status_code == 401
    with app.app_context():
        db = get_db()
        db.execute('UPDATE users SET locked_until=0 WHERE username="teller"')
        db.commit()
    response = post(client, '/signon.asp?next=https://evil.example', {'operator': 'teller', 'password': 'Teller-demo-42!'})
    assert 'evil.example' not in response.location


def test_session_revocation_is_scoped(app, client):
    signon(client)
    other = app.test_client()
    signon(other, 'auditor', 'Auditor-demo-42!')
    with app.app_context():
        sid = get_db().execute('SELECT id FROM sessions WHERE user_id=3').fetchone()[0]
    post(client, '/operators.asp', {'row': sid})
    assert other.get('/screen.asp').status_code == 200
    supervisor = app.test_client()
    signon(supervisor, 'supervisor', 'Supervisor-demo-42!')
    post(supervisor, '/operators.asp', {'row': sid})
    assert '/signon.asp' in other.get('/screen.asp').location


def test_signoff_revokes_expired_workstation_without_renewing(app, client):
    signon(client)
    csrf = ticket(client.get('/terminal.asp'))
    post(client, '/screen.asp?screen=X990', {'f01': 'access_expired'})
    response = client.post('/signoff.asp', data={'_ticket': csrf})
    assert '/signon.asp' in response.location
    assert client.get_cookie(client.application.config['ACCESS_COOKIE_NAME']) is None
    assert client.get_cookie(client.application.config['REFRESH_COOKIE_NAME']) is None
    with app.app_context():
        assert get_db().execute('SELECT revoked FROM sessions').fetchone()[0] == 1


def test_expired_post_preserves_review_context_and_does_not_execute(client):
    from conftest import prepare
    signon(client)
    location = prepare(client)
    csrf = ticket(client.get(location))
    post(client, '/screen.asp?screen=X990', {'f01': 'access_expired'})
    response = client.post(location, data={'_ticket': csrf, 'confirm': 'Y'})
    assert '/renew.asp' in response.location and 'review.asp' in response.location
    post(client, response.location)
    assert 'REVIEW CHECKPOINT' in client.get(location).text
