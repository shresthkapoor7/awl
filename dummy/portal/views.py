import re
import time

from flask import Blueprint, abort, g, redirect, render_template, request, url_for

from .auth import now, safe_next, verify_operator
from .db import audit, get_db
from .service import BusinessError, create_draft, post_draft

bp = Blueprint('portal', __name__)


def member_record(member_id):
    row = get_db().execute('SELECT * FROM members WHERE id=?', (member_id,)).fetchone()
    if not row:
        abort(404, 'MEM-01: Member record not found.')
    return row


def require_write():
    if g.user['role'] == 'viewer':
        abort(403, 'SEC-21: Inquiry-only operator. This function requires servicing privileges.')


def draft_record(reference, owner=False):
    draft = get_db().execute('SELECT d.*, u.display_name AS operator FROM drafts d JOIN users u ON u.id=d.user_id WHERE d.id=?', (reference,)).fetchone()
    if not draft:
        abort(404, 'REQ-01: Request not found.')
    if draft['user_id'] != g.user['id'] and (owner or g.user['role'] != 'supervisor'):
        abort(403, 'SEC-22: Request is not assigned to this operator.')
    return draft


def consume_scenario(expected):
    db = get_db()
    cursor = db.execute("UPDATE sessions SET scenario='' WHERE id=? AND scenario=?", (g.auth_session['id'], expected))
    db.commit()
    return cursor.rowcount == 1


@bp.get('/')
def index():
    return redirect(url_for('portal.terminal'))


@bp.get('/terminal.asp')
def terminal():
    resume = safe_next(request.args.get('resume'))
    if resume.startswith('/terminal.asp') or resume.startswith('/accounts.asp'):
        resume = url_for('portal.screen', screen='H000')
    return render_template('terminal.html', resume=resume)


@bp.route('/screen.asp', methods=['GET', 'POST'])
def screen():
    code = request.values.get('screen', 'H000')
    db = get_db()
    if code == 'H000':
        stats = {
            'members': db.execute('SELECT count(*) FROM members').fetchone()[0],
            'accounts': db.execute('SELECT count(*) FROM accounts').fetchone()[0],
            'pending': db.execute("SELECT count(*) FROM drafts WHERE user_id=? AND state='REVIEW'", (g.user['id'],)).fetchone()[0],
        }
        recent = db.execute('SELECT * FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 7', (g.user['id'],)).fetchall()
        return render_template('home.html', stats=stats, recent=recent)
    if code == 'M100':
        if consume_scenario('slow'):
            time.sleep(3)
        if consume_scenario('app_error'):
            return render_template('error.html', code=503, message='HOST-52: Member index temporarily unavailable. Retry this inquiry.', retry=url_for('portal.screen', screen='M100')), 503
        if consume_scenario('dialog'):
            return render_template('interstitial.html')
        results, query, kind, error = None, '', 'number', None
        page = 0
        if request.method == 'POST':
            if request.form.get('cmd') == 'select':
                selected = request.form.get('row', '')
                if selected:
                    member_record(selected)
                    return redirect(url_for('portal.screen', screen='M200', m=selected))
                error = 'SEL-01: Mark one row, then choose Process.'
            elif request.form.get('cmd') != 'acknowledge':
                query = request.form.get('f01', '').strip()[:64]
                kind = request.form.get('f02', 'number')
                try:
                    page = min(max(int(request.form.get('pg', '0')), 0), 1000)
                except ValueError:
                    page = 0
                if not query:
                    error = 'VAL-01: Supply an inquiry value. Wildcard-only inquiries are not permitted.'
                elif kind == 'number':
                    results = db.execute('SELECT * FROM members WHERE id=?', (query,)).fetchall()
                elif kind == 'surname':
                    # Literal surname prefix; wildcard characters are treated as text.
                    escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                    results = db.execute("SELECT * FROM members WHERE last_name LIKE ? ESCAPE '\\' ORDER BY last_name,first_name,id LIMIT 11 OFFSET ?", (escaped+'%', page*10)).fetchall()
                else:
                    error = 'VAL-02: Invalid inquiry index.'
        more = bool(results and len(results) > 10)
        return render_template('search.html', results=results[:10] if results is not None else None, query=query, kind=kind, error=error, page=page, more=more)
    if code == 'M200':
        member = member_record(request.args.get('m', ''))
        return render_template('member.html', member=member)
    if code == 'S310':
        require_write()
        member = member_record(request.values.get('m', ''))
        error = None
        if request.method == 'POST':
            try:
                reference = create_draft(member, g.user['id'], request.form)
                return redirect(url_for('portal.review', r=reference))
            except BusinessError as exc:
                error = str(exc)
        accounts = db.execute("SELECT * FROM accounts WHERE member_id=? AND status='OPEN' ORDER BY id", (member['id'],)).fetchall()
        return render_template('opening.html', member=member, accounts=accounts, error=error), 422 if error else 200
    if code == 'M220':
        member = member_record(request.values.get('m', ''))
        error = None
        if request.method == 'POST':
            require_write()
            category, body = request.form.get('f01', ''), request.form.get('f02', '').strip()
            if category not in {'INQUIRY', 'FOLLOWUP', 'GENERAL'} or not 1 <= len(body) <= 1000:
                error = 'VAL-30: Choose a category and enter 1–1000 characters.'
            else:
                db.execute('INSERT INTO notes(member_id,user_id,category,body) VALUES (?,?,?,?)', (member['id'], g.user['id'], category, body))
                audit('SERVICE_NOTE_ADDED', member['id'])
                db.commit()
                return redirect(url_for('portal.screen', screen='M220', m=member['id']))
        notes = db.execute('SELECT n.*,u.display_name FROM notes n JOIN users u ON u.id=n.user_id WHERE n.member_id=? ORDER BY n.id DESC LIMIT 100', (member['id'],)).fetchall()
        return render_template('notes.html', member=member, notes=notes, error=error), 422 if error else 200
    if code == 'M210':
        member = member_record(request.values.get('m', ''))
        error = None
        if request.method == 'POST':
            require_write()
            if member['status'] != 'ACTIVE' and g.user['role'] != 'supervisor':
                abort(403, 'SEC-41: Contact maintenance on a restricted or closed record requires a supervisor.')
            fields = {key: request.form.get(key, '').strip() for key in ['address', 'city', 'state', 'postal', 'email', 'phone']}
            if any(not value or len(value) > 120 for value in fields.values()):
                error = 'VAL-31: Every contact field is required; maximum 120 characters per field.'
            elif not re.fullmatch(r'[A-Z]{2}', fields['state']) or not re.fullmatch(r'\d{5}', fields['postal']):
                error = 'VAL-32: State must be two uppercase letters; ZIP must contain five digits.'
            elif not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', fields['email']) or not re.fullmatch(r'[0-9()+ .-]{7,24}', fields['phone']):
                error = 'VAL-33: Check email and telephone formatting.'
            elif request.form.get('confirm') != 'Y':
                error = 'VAL-34: Confirm the member supplied these details.'
            else:
                cursor = db.execute('''UPDATE members SET address=?,city=?,state=?,postal=?,email=?,phone=?,version=version+1
                    WHERE id=? AND version=?''', (*fields.values(), member['id'], request.form.get('version', '')))
                if cursor.rowcount != 1:
                    db.rollback()
                    error = 'MEM-09: Another operator changed this record. Reload before saving.'
                else:
                    audit('CONTACT_UPDATED', member['id'])
                    db.commit()
                    return redirect(url_for('portal.screen', screen='M200', m=member['id'], saved='1'))
        return render_template('contact.html', member=member, error=error), 422 if error else 200
    if code == 'W400':
        scope = request.args.get('scope', 'mine')
        if scope == 'all' and g.user['role'] == 'supervisor':
            drafts = db.execute('SELECT d.*,u.username FROM drafts d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 100').fetchall()
        else:
            drafts = db.execute('SELECT d.*,u.username FROM drafts d JOIN users u ON u.id=d.user_id WHERE user_id=? ORDER BY d.created_at DESC LIMIT 100', (g.user['id'],)).fetchall()
        return render_template('queue.html', drafts=drafts, scope=scope)
    if code == 'A900':
        if g.user['role'] == 'supervisor':
            events = db.execute('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 150').fetchall()
        else:
            events = db.execute('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE user_id=? ORDER BY a.id DESC LIMIT 100', (g.user['id'],)).fetchall()
        return render_template('audit.html', events=events)
    if code == 'X990':
        notice = None
        if request.method == 'POST':
            scenario = request.form.get('f01', '')
            if scenario not in {'', 'slow', 'app_error', 'dialog', 'access_expired', 'session_expired', 'lost_confirmation'}:
                abort(400, 'VAL-90: Unknown diagnostic.')
            if scenario == 'access_expired':
                db.execute('UPDATE sessions SET access_expires=0 WHERE id=?', (g.auth_session['id'],))
            elif scenario == 'session_expired':
                db.execute('UPDATE sessions SET expires_at=0 WHERE id=?', (g.auth_session['id'],))
            else:
                db.execute('UPDATE sessions SET scenario=? WHERE id=?', (scenario, g.auth_session['id']))
            audit('WORKSTATION_DIAGNOSTIC', scenario)
            db.commit()
            notice = 'Diagnostic accepted. Return to member inquiry to exercise it; posting-response loss applies to the next successful share posting.'
        scenario = db.execute('SELECT scenario FROM sessions WHERE id=?', (g.auth_session['id'],)).fetchone()[0]
        return render_template('diagnostics.html', scenario=scenario, notice=notice)
    abort(404, 'NAV-01: Function code is not installed on this workstation.')


@bp.get('/accounts.asp')
def accounts():
    member = member_record(request.args.get('m', ''))
    rows = get_db().execute('SELECT * FROM accounts WHERE member_id=? ORDER BY id', (member['id'],)).fetchall()
    return render_template('accounts.html', member=member, accounts=rows)


@bp.route('/account.asp', methods=['GET', 'POST'])
def account():
    db = get_db()
    row = db.execute('SELECT * FROM accounts WHERE id=?', (request.values.get('a', ''),)).fetchone()
    if not row:
        abort(404, 'SEL-02: Account not found. Return to the register and select one row.')
    transactions = db.execute('SELECT * FROM ledger WHERE account_id=? ORDER BY id DESC LIMIT 100', (row['id'],)).fetchall()
    return render_template('account.html', account=row, member=member_record(row['member_id']), transactions=transactions)


@bp.route('/review.asp', methods=['GET', 'POST'])
def review():
    reference = request.values.get('r', '')
    draft = draft_record(reference)
    member = member_record(draft['member_id'])
    error = None
    if request.method == 'POST':
        require_write()
        draft_record(reference, owner=True)
        if request.form.get('cmd') == 'cancel':
            db = get_db()
            changed = db.execute("UPDATE drafts SET state='CANCELLED',approved_by=NULL,approved_at=NULL WHERE id=? AND state='REVIEW'", (reference,)).rowcount
            if changed:
                audit('SHARE_REQUEST_CANCELLED', reference)
            db.commit()
            return redirect(url_for('portal.review', r=reference))
        try:
            post_draft(reference, g.user['id'], request.form.get('confirm') == 'Y')
            if consume_scenario('lost_confirmation'):
                return render_template('error.html', code=503, message='HOST-71: Posting response was lost. Transaction status is uncertain from this screen. Retrieve the request before attempting another posting.', retry=url_for('portal.review', r=reference)), 503
            return redirect(url_for('portal.review', r=reference))
        except BusinessError as exc:
            error = str(exc)
    approver = get_db().execute('SELECT display_name FROM users WHERE id=?', (draft['approved_by'],)).fetchone() if draft['approved_by'] else None
    return render_template('review.html', draft=draft, member=member, error=error, approver=approver), 422 if error else 200


@bp.route('/authorize.asp', methods=['GET', 'POST'])
def authorize():
    reference = request.values.get('r', '')
    draft = draft_record(reference)
    error = None
    if request.method == 'POST':
        supervisor = verify_operator(request.form.get('operator', '').strip(), request.form.get('password', ''))
        if not supervisor or supervisor['role'] != 'supervisor':
            error = 'SEC-42: Supervisor credentials rejected or insufficient authority.'
        elif supervisor['id'] == draft['user_id']:
            error = 'SEC-43: The originating operator cannot approve their own request.'
        else:
            db = get_db()
            db.execute('BEGIN IMMEDIATE')
            draft = draft_record(reference)
            member = member_record(draft['member_id'])
            if draft['state'] != 'REVIEW' or member['version'] != draft['member_version']:
                db.rollback()
                error = 'REQ-04: Request is no longer awaiting approval or member state changed.'
            else:
                db.execute("UPDATE drafts SET approved_by=?,approved_at=strftime('%Y-%m-%d %H:%M:%S','now') WHERE id=?", (supervisor['id'], reference))
                audit('REQUEST_AUTHORIZED', reference, user_id=supervisor['id'])
                db.commit()
                return redirect(url_for('portal.review', r=reference))
    return render_template('authorize.html', draft=draft, member=member_record(draft['member_id']), error=error), 403 if error else 200


@bp.route('/operators.asp', methods=['GET', 'POST'])
def operators():
    db = get_db()
    if request.method == 'POST':
        sid = request.form.get('row', '')
        if g.user['role'] == 'supervisor':
            changed = db.execute('UPDATE sessions SET revoked=1 WHERE id=?', (sid,)).rowcount
        else:
            changed = db.execute('UPDATE sessions SET revoked=1 WHERE id=? AND user_id=?', (sid, g.user['id'])).rowcount
        if changed:
            audit('OPERATOR_SESSION_REVOKED')
        db.commit()
        return redirect(url_for('portal.operators'))
    query = 'SELECT s.*,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id'
    args = ()
    if g.user['role'] != 'supervisor':
        query += ' WHERE user_id=?'
        args = (g.user['id'],)
    rows = db.execute(query+' ORDER BY created_at DESC LIMIT 50', args).fetchall()
    return render_template('operators.html', sessions=rows, clock=now())
