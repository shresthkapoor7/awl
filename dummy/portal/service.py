import re
import secrets
from decimal import Decimal, InvalidOperation

from .db import PRODUCTS, audit, get_db


class BusinessError(Exception):
    pass


def amount_cents(value):
    if not re.fullmatch(r'\d{1,7}(?:\.\d{1,2})?', value):
        raise BusinessError('VAL-14: Enter dollars and cents without commas, signs, or currency symbols.')
    try:
        cents = int(Decimal(value) * 100)
    except (InvalidOperation, ValueError):
        raise BusinessError('VAL-14: Amount is invalid.') from None
    if not 0 < cents <= 10_000_000:
        raise BusinessError('VAL-15: Funding must be between 0.01 and 100,000.00.')
    return cents


def check_opening(member, product, source_id, amount, nickname):
    db = get_db()
    if member['status'] == 'CLOSED':
        raise BusinessError('MEM-04: Membership is closed. New shares are not permitted.')
    if product not in PRODUCTS:
        raise BusinessError('VAL-10: Select a supported share class.')
    if amount < PRODUCTS[product][1]:
        raise BusinessError(f'VAL-16: Minimum opening amount for {PRODUCTS[product][0]} is {PRODUCTS[product][1]/100:.2f}.')
    if not nickname.strip() or len(nickname) > 32:
        raise BusinessError('VAL-17: Share description is required and must be 32 characters or fewer.')
    if db.execute('SELECT 1 FROM accounts WHERE member_id=? AND product=?', (member['id'], product)).fetchone():
        raise BusinessError('SHR-08: Member already holds this share class. No account was opened.')
    source = db.execute("SELECT * FROM accounts WHERE id=? AND member_id=? AND status='OPEN'", (source_id, member['id'])).fetchone()
    if not source:
        raise BusinessError('VAL-18: Select an open funding account belonging to this member.')
    if source['balance_cents'] < amount:
        raise BusinessError('FUN-02: Available funds are insufficient. No funds were moved.')
    return source


def create_draft(member, user_id, form):
    db = get_db()
    amount = amount_cents(form.get('f04', '').strip())
    product, source_id, nickname = form.get('f01', ''), form.get('f03', ''), form.get('f02', '').strip()
    db.execute('BEGIN IMMEDIATE')
    try:
        # Re-read all business state inside the transaction.
        member = db.execute('SELECT * FROM members WHERE id=?', (member['id'],)).fetchone()
        check_opening(member, product, source_id, amount, nickname)
        if form.get('f05') != 'Y':
            raise BusinessError('VAL-19: Confirm that the member requested this share.')
        pending = db.execute("SELECT id FROM drafts WHERE member_id=? AND user_id=? AND product=? AND state='REVIEW'", (member['id'], user_id, product)).fetchone()
        if pending:
            raise BusinessError(f'SHR-09: A request for this share is already pending ({pending["id"]}). Use Work in process to resume or cancel it.')
        reference = 'R' + secrets.token_hex(5).upper()
        db.execute('''INSERT INTO drafts(id,member_id,user_id,product,nickname,source_id,amount_cents,member_version)
                      VALUES (?,?,?,?,?,?,?,?)''',
                   (reference, member['id'], user_id, product, nickname, source_id, amount, member['version']))
        audit('SHARE_REQUEST_PREPARED', reference)
        db.commit()
        return reference
    except Exception:
        db.rollback()
        raise


def post_draft(reference, user_id, confirmed):
    db = get_db()
    db.execute('BEGIN IMMEDIATE')
    try:
        draft = db.execute('SELECT * FROM drafts WHERE id=? AND user_id=?', (reference, user_id)).fetchone()
        if not draft:
            raise BusinessError('SEC-22: Request is not assigned to this operator.')
        if draft['state'] == 'POSTED':
            db.rollback()
            return draft['account_id']  # Retrying a submitted form cannot create another account.
        if draft['state'] != 'REVIEW':
            raise BusinessError('REQ-03: This request was cancelled.')
        if not confirmed:
            raise BusinessError('VAL-20: Check the final authorization box before posting.')
        member = db.execute('SELECT * FROM members WHERE id=?', (draft['member_id'],)).fetchone()
        if member['version'] != draft['member_version']:
            raise BusinessError('MEM-09: Member record changed after review. Cancel this request and prepare it again.')
        source = check_opening(member, draft['product'], draft['source_id'], draft['amount_cents'], draft['nickname'])
        if member['status'] == 'RESTRICTED' and not draft['approved_by']:
            raise BusinessError('SEC-40: Supervisor authorization is required for this request.')
        account_id = member['id'] + '-' + {'SAV': '01', 'HOL': '02', 'EDU': '03'}[draft['product']]
        db.execute('INSERT INTO accounts(id,member_id,product,nickname,balance_cents,opened) VALUES (?,?,?,?,?,date(\'now\'))',
                   (account_id, member['id'], draft['product'], draft['nickname'], draft['amount_cents']))
        remaining = source['balance_cents'] - draft['amount_cents']
        db.execute('UPDATE accounts SET balance_cents=? WHERE id=?', (remaining, source['id']))
        db.execute('INSERT INTO ledger(account_id,reference,description,amount_cents,balance_cents) VALUES (?,?,?,?,?)',
                   (source['id'], reference, 'Share opening transfer', -draft['amount_cents'], remaining))
        db.execute('INSERT INTO ledger(account_id,reference,description,amount_cents,balance_cents) VALUES (?,?,?,?,?)',
                   (account_id, reference, 'Initial share funding', draft['amount_cents'], draft['amount_cents']))
        db.execute("UPDATE drafts SET state='POSTED',account_id=? WHERE id=?", (account_id, reference))
        audit('SHARE_OPENED', reference)
        db.commit()
        return account_id
    except Exception:
        db.rollback()
        raise
