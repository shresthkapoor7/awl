from urllib.parse import parse_qs, urlsplit

import pytest

from conftest import post, prepare, signon
from portal.db import get_db


def ref(location):
    return parse_qs(urlsplit(location).query)['r'][0]


def test_search_business_outcomes_and_pagination(client):
    signon(client)
    response = post(client, '/screen.asp?screen=M100', {'f01': '99999', 'f02': 'number'})
    assert response.status_code == 200 and 'MEM-01' in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': 'Reed', 'f02': 'surname'})
    assert '12345' in response.text and '12348' in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': 'Example', 'f02': 'surname'})
    assert response.text.count('type="radio"') == 10 and 'Next block' in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': 'Example', 'f02': 'surname', 'pg': '2'})
    assert response.text.count('type="radio"') == 4 and 'Next block' not in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': "' OR 1=1 --", 'f02': 'number'})
    assert 'MEM-01' in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': '%', 'f02': 'surname'})
    assert 'MEM-01' in response.text


def test_draft_review_atomic_post_idempotence_and_persistence(app, client):
    signon(client)
    location = prepare(client)
    reference = ref(location)
    response = client.get(location)
    assert 'REVIEW CHECKPOINT' in response.text
    with app.app_context():
        db = get_db()
        before = db.execute('SELECT balance_cents FROM accounts WHERE id="12345-00"').fetchone()[0]
        assert not db.execute('SELECT 1 FROM accounts WHERE id="12345-01"').fetchone()
    assert post(client, location, {'r': reference}).status_code == 422
    response = post(client, location, {'r': reference, 'confirm': 'Y'})
    assert response.status_code == 302
    assert 'POSTED' in client.get(location).text
    # A second POST with the same reference does not duplicate funds or ledger entries.
    assert post(client, location, {'r': reference, 'confirm': 'Y'}, source='/terminal.asp').status_code == 302
    with app.app_context():
        db = get_db()
        assert db.execute('SELECT balance_cents FROM accounts WHERE id="12345-00"').fetchone()[0] == before-2500
        assert db.execute('SELECT balance_cents FROM accounts WHERE id="12345-01"').fetchone()[0] == 2500
        assert db.execute('SELECT count(*) FROM ledger WHERE reference=?', (reference,)).fetchone()[0] == 2
        assert db.execute('SELECT sum(amount_cents) FROM ledger WHERE reference=?', (reference,)).fetchone()[0] == 0
    # A newly constructed app sees the same saved accounts and requests.
    from portal import create_app
    reopened = create_app({'TESTING': True, 'DATABASE': app.config['DATABASE'], 'SECRET_KEY': 'tests-only-key'})
    with reopened.app_context():
        assert get_db().execute('SELECT state FROM drafts WHERE id=?', (reference,)).fetchone()[0] == 'POSTED'


@pytest.mark.parametrize('member,amount,expected', [('12347','25.00','MEM-04'), ('12349','25.00','FUN-02'), ('12350','25.00','SHR-08'), ('12345','1.00','VAL-16'), ('12345','1,000','VAL-14'), ('12345','NaN','VAL-14'), ('12345','-10','VAL-14')])
def test_business_validation(client, member, amount, expected):
    signon(client)
    response = post(client, f'/screen.asp?screen=S310&m={member}', {'f01': 'SAV', 'f02': 'Savings', 'f03': member+'-00', 'f04': amount, 'f05': 'Y'})
    assert response.status_code == 422 and expected in response.text


def test_restricted_request_requires_scoped_supervisor_approval(app, client):
    signon(client)
    location = prepare(client, '12346')
    reference = ref(location)
    assert 'SEC-40' in post(client, location, {'confirm': 'Y'}).text
    auth_path = '/authorize.asp?r='+reference
    rejected = post(client, auth_path, {'operator': 'teller', 'password': 'Teller-demo-42!'})
    assert rejected.status_code == 403
    accepted = post(client, auth_path, {'operator': 'supervisor', 'password': 'Supervisor-demo-42!'})
    assert accepted.status_code == 302
    assert 'Casey / Operations' in client.get('/terminal.asp').text  # identity unchanged
    assert post(client, location, {'confirm': 'Y'}).status_code == 302
    second = prepare(client, '12346', 'HOL')
    assert 'SEC-40' in post(client, second, {'confirm': 'Y'}).text
    with app.app_context():
        assert get_db().execute('SELECT approved_by FROM drafts WHERE id=?', (ref(second),)).fetchone()[0] is None


def test_permissions_and_cross_operator_request_access(app, client):
    signon(client)
    location = prepare(client)
    auditor = app.test_client()
    signon(auditor, 'auditor', 'Auditor-demo-42!')
    assert auditor.get('/screen.asp?screen=M200&m=12345').status_code == 200
    assert auditor.get('/screen.asp?screen=S310&m=12345').status_code == 403
    assert auditor.get(location).status_code == 403
    assert post(auditor, '/screen.asp?screen=M220&m=12345', {'f01':'GENERAL','f02':'Unauthorized'}, source='/terminal.asp').status_code == 403
    supervisor = app.test_client()
    signon(supervisor, 'supervisor', 'Supervisor-demo-42!')
    assert supervisor.get(location).status_code == 200
    assert post(supervisor, location, {'confirm':'Y'}, source='/terminal.asp').status_code == 403


def test_post_revalidates_balance_and_member_revision(app, client):
    signon(client)
    location = prepare(client)
    with app.app_context():
        db = get_db()
        db.execute('UPDATE accounts SET balance_cents=0 WHERE id="12345-00"')
        db.commit()
    assert 'FUN-02' in post(client, location, {'confirm':'Y'}).text
    with app.app_context():
        db = get_db()
        db.execute('UPDATE members SET version=version+1 WHERE id="12345"')
        db.commit()
    assert 'MEM-09' in post(client, location, {'confirm':'Y'}).text
    with app.app_context():
        assert get_db().execute('SELECT count(*) FROM accounts WHERE id="12345-01"').fetchone()[0] == 0


def test_cancel_and_duplicate_pending(client):
    signon(client)
    location = prepare(client)
    response = post(client, '/screen.asp?screen=S310&m=12345', {'f01':'SAV','f02':'Other','f03':'12345-00','f04':'25','f05':'Y'})
    assert 'SHR-09' in response.text
    post(client, location, {'cmd':'cancel'})
    response = post(client, location, {'confirm':'Y'}, source='/terminal.asp')
    assert 'REQ-03' in response.text
    assert 'REVIEW CHECKPOINT' in client.get(prepare(client)).text


def test_contact_conflict_notes_escape_and_audit_redaction(app, client):
    signon(client)
    values = {'address':'101 Example Road','city':'Sample City','state':'NY','postal':'00000',
              'email':'changed@example.invalid','phone':'202-555-0101','version':'1','confirm':'Y'}
    path = '/screen.asp?screen=M210&m=12345'
    assert post(client, path, values).status_code == 302
    assert 'MEM-09' in post(client, path, values).text
    response = post(client, '/screen.asp?screen=M220&m=12345', {'f01':'GENERAL','f02':'<script>alert(1)</script>'}, follow_redirects=True)
    assert '&lt;script&gt;' in response.text and '<script>alert(1)</script>' not in response.text
    with app.app_context():
        journal = str([tuple(row) for row in get_db().execute('SELECT * FROM audit')])
        assert 'changed@example.invalid' not in journal and '101 Example Road' not in journal


def test_faults_are_once_only_scoped_and_lost_post_is_reconcilable(app, client):
    signon(client)
    other = app.test_client()
    signon(other)
    post(client, '/screen.asp?screen=X990', {'f01':'app_error'})
    assert other.get('/screen.asp?screen=M100').status_code == 200
    assert client.get('/screen.asp?screen=M100').status_code == 503
    assert client.get('/screen.asp?screen=M100').status_code == 200
    post(client, '/screen.asp?screen=X990', {'f01':'dialog'})
    assert 'ACKNOWLEDGMENT REQUIRED' in client.get('/screen.asp?screen=M100').text
    assert 'MEMBER INDEX INQUIRY' in client.get('/screen.asp?screen=M100').text
    location = prepare(client)
    post(client, '/screen.asp?screen=X990', {'f01':'lost_confirmation'})
    response = post(client, location, {'confirm':'Y'})
    assert response.status_code == 503 and 'HOST-71' in response.text
    assert 'POSTED' in client.get(location).text
    with app.app_context():
        assert get_db().execute('SELECT count(*) FROM accounts WHERE id="12345-01"').fetchone()[0] == 1


def test_supervisor_cannot_self_approve(client):
    signon(client, 'supervisor', 'Supervisor-demo-42!')
    location = prepare(client, '12346')
    response = post(client, '/authorize.asp?r='+ref(location), {'operator':'supervisor','password':'Supervisor-demo-42!'})
    assert 'SEC-43' in response.text


def test_foreign_funding_account_rejected(client):
    signon(client)
    response = post(client, '/screen.asp?screen=S310&m=12345', {'f01':'SAV','f02':'Savings','f03':'12348-00','f04':'25','f05':'Y'})
    assert response.status_code == 422 and 'VAL-18' in response.text


def test_bulletin_acknowledgment_returns_a_fresh_inquiry_form(client):
    from conftest import ticket
    signon(client)
    post(client, '/screen.asp?screen=X990', {'f01': 'dialog'})
    bulletin = client.get('/screen.asp?screen=M100')
    assert 'ACKNOWLEDGMENT REQUIRED' in bulletin.text
    response = client.post('/screen.asp', data={
        '_ticket': ticket(bulletin), 'screen': 'M100', 'cmd': 'acknowledge',
    })
    assert response.status_code == 200
    assert 'MEMBER INDEX INQUIRY' in response.text
    assert 'VAL-01' not in response.text
    response = post(client, '/screen.asp?screen=M100', {'f01': '12348', 'f02': 'number'})
    assert '12348' in response.text and 'ACKNOWLEDGMENT REQUIRED' not in response.text
