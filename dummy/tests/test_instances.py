"""Fixture isolation and CLI checks, executed by CI."""
import pytest

from conftest import post, prepare, signon
from portal import create_app
from portal.db import get_db
from run import parse_args


def test_fixture_restart_preserves_requests_and_isolates_state(tmp_path):
    first_dir, second_dir = tmp_path / 'first', tmp_path / 'second'
    first = create_app({'TESTING': True}, instance_path=first_dir)
    second = create_app({'TESTING': True}, instance_path=second_dir)
    client = first.test_client()
    signon(client)
    location = prepare(client)
    post(client, '/screen.asp?screen=X990', {'f01': 'app_error'})
    resumed = create_app({'TESTING': True}, instance_path=first_dir)
    assert resumed.config['SECRET_KEY'] == first.config['SECRET_KEY']
    assert first.config['SECRET_KEY'] != second.config['SECRET_KEY']
    assert first.config['ACCESS_COOKIE_NAME'] != second.config['ACCESS_COOKIE_NAME']
    assert first.config['REFRESH_COOKIE_NAME'] != second.config['REFRESH_COOKIE_NAME']
    assert first.config['SESSION_COOKIE_NAME'] != second.config['SESSION_COOKIE_NAME']
    with resumed.app_context():
        assert get_db().execute('SELECT count(*) FROM drafts').fetchone()[0] == 1
    with second.app_context():
        assert get_db().execute('SELECT count(*) FROM drafts').fetchone()[0] == 0
        assert get_db().execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
        assert get_db().execute('SELECT balance_cents FROM accounts WHERE id="12345-00"').fetchone()[0] == 245075
    reopened_client = resumed.test_client()
    for key in ['ACCESS_COOKIE_NAME', 'REFRESH_COOKIE_NAME']:
        name = resumed.config[key]
        reopened_client.set_cookie(name, client.get_cookie(name).value)
    assert 'REVIEW CHECKPOINT' in reopened_client.get(location).text
    assert reopened_client.get('/screen.asp?screen=M100').status_code == 503


def test_configured_database_does_not_write_a_default_signing_key(tmp_path):
    root = tmp_path / 'isolated'
    app = create_app({'TESTING': True, 'DATABASE': str(root / 'test.sqlite3'), 'SECRET_KEY': 'explicit-test-key'})
    assert app.instance_path == str(root)
    assert not (root / 'signing.key').exists()


def test_cli_accepts_instance_path_and_port():
    args = parse_args(['--instance-dir', 'fixtures/alternate', '--port', '7311'])
    assert args.instance_dir == 'fixtures/alternate' and args.port == 7311


@pytest.mark.parametrize('port', ['0', '-1', '65536', 'not-a-port'])
def test_cli_rejects_invalid_port(port):
    with pytest.raises(SystemExit) as error:
        parse_args(['--port', port])
    assert error.value.code == 2
