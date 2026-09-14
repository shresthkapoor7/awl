import sqlite3
from pathlib import Path

from flask import current_app, g
from werkzeug.security import generate_password_hash

PRODUCTS = {
    'SAV': ('Regular savings', 500),
    'HOL': ('Holiday club', 1000),
    'EDU': ('Education savings', 2500),
}


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(current_app.config['DATABASE'], timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
        g.db.execute('PRAGMA busy_timeout = 10000')
    return g.db


def close_db(_error=None):
    db = g.pop('db', None)
    if db:
        db.close()


def audit(event, reference='', user_id=None):
    user_id = user_id if user_id is not None else (g.user['id'] if getattr(g, 'user', None) else None)
    get_db().execute('INSERT INTO audit(user_id,event,reference) VALUES (?,?,?)',
                     (user_id, event, reference))


def initialize(app):
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True)
    with app.app_context():
        db = get_db()
        db.execute('PRAGMA journal_mode = WAL')
        db.executescript(Path(__file__).with_name('schema.sql').read_text())
        if db.execute('SELECT COUNT(*) FROM users').fetchone()[0]:
            return
        # Public, local-only fixture credentials. Never reuse these outside this demo.
        for username, name, role, password in [
            ('teller', 'Casey / Operations', 'clerk', 'Teller-demo-42!'),
            ('supervisor', 'Morgan / Supervisor', 'supervisor', 'Supervisor-demo-42!'),
            ('auditor', 'Alex / Inquiry', 'viewer', 'Auditor-demo-42!'),
        ]:
            db.execute('INSERT INTO users(username,display_name,role,password_hash) VALUES (?,?,?,?)',
                       (username, name, role, generate_password_hash(password)))
        names = [('12345', 'Avery', 'Reed', 'ACTIVE'), ('12346', 'Jordan', 'Vale', 'RESTRICTED'),
                 ('12347', 'Robin', 'Chen', 'CLOSED'), ('12348', 'Sam', 'Reed', 'ACTIVE'),
                 ('12349', 'Taylor', 'Brooks', 'ACTIVE'), ('12350', 'Jamie', 'Ortiz', 'ACTIVE')]
        names += [(str(12400 + i), f'Member{i:02}', 'Example', 'ACTIVE') for i in range(24)]
        for index, (mid, first, last, status) in enumerate(names):
            db.execute('INSERT INTO members VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)',
                       (mid, first, last, status, '2019-04-12', '003', f'{100+index} Example Lane',
                        'Sample City', 'NY', '00000', f'member{mid}@example.invalid', '202-555-01%02d' % index))
            acc = f'{mid}-00'
            balance = 250 if mid == '12349' else 245075 + index * 1700
            db.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?,?)',
                       (acc, mid, 'CHK', 'Share draft', balance, 'CLOSED' if status == 'CLOSED' else 'OPEN', '2019-04-12'))
            db.execute('INSERT INTO ledger(account_id,reference,description,amount_cents,balance_cents) VALUES (?,?,?,?,?)',
                       (acc, 'SEED', 'Opening balance — synthetic funds', balance, balance))
        db.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?,?)',
                   ('12350-01', '12350', 'SAV', 'Existing savings', 10000, 'OPEN', '2024-01-10'))
        db.execute('INSERT INTO ledger(account_id,reference,description,amount_cents,balance_cents) VALUES (?,?,?,?,?)',
                   ('12350-01', 'SEED', 'Opening balance — synthetic funds', 10000, 10000))
        db.commit()
