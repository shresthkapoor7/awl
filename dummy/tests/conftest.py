import re

import pytest

from portal import create_app


@pytest.fixture
def app(tmp_path):
    return create_app({'TESTING': True, 'DATABASE': str(tmp_path / 'test.sqlite3'), 'SECRET_KEY': 'tests-only-key'})


@pytest.fixture
def client(app):
    return app.test_client()


def ticket(response):
    match = re.search(r'name="_ticket" value="([^"]+)"', response.text)
    assert match, response.text[:1000]
    return match.group(1)


def signon(client, operator='teller', password='Teller-demo-42!'):
    token = ticket(client.get('/signon.asp'))
    response = client.post('/signon.asp', data={'_ticket': token, 'operator': operator, 'password': password})
    assert response.status_code == 302
    return response


def post(client, path, data=None, source=None, **kwargs):
    token = ticket(client.get(source or path))
    return client.post(path, data={'_ticket': token, **(data or {})}, **kwargs)


def prepare(client, member='12345', product='SAV', amount='25.00'):
    path = f'/screen.asp?screen=S310&m={member}'
    response = post(client, path, {'screen': 'S310', 'm': member, 'f01': product, 'f02': 'Rainy day',
                                 'f03': member+'-00', 'f04': amount, 'f05': 'Y'})
    assert response.status_code == 302, response.text
    return response.headers['Location']
