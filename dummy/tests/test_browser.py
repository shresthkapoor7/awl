"""Live Chromium tests: servicing actions happen exclusively through visible UI forms."""
import re
import threading

import pytest
from playwright.sync_api import expect, sync_playwright
from werkzeug.serving import make_server


@pytest.fixture
def browser_page(app):
    server = make_server('127.0.0.1', 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                page = context.new_page()
                page.set_default_timeout(8000)
                page.goto(f'http://127.0.0.1:{server.server_port}')
                yield page
            finally:
                browser.close()
    finally:
        server.shutdown()
        thread.join(timeout=5)


def login(page, operator='teller', password='Teller-demo-42!'):
    page.get_by_label('Operator ID').fill(operator)
    page.get_by_label('Password', exact=True).fill(password)
    page.get_by_role('button', name='Establish session').click()
    expect(page.frame_locator('iframe[name="work"]').get_by_role('heading', name='WORKSTATION BULLETIN')).to_be_visible()


def lookup(page, member, *, surname=None):
    page.get_by_role('link', name='10 Member inquiry').click()
    work = page.frame_locator('iframe[name="work"]')
    work.locator('select[name="f02"]').select_option('surname' if surname else 'number')
    work.locator('input[name="f01"]').fill(surname or member)
    work.get_by_role('button', name='Transmit', exact=True).click()
    work.get_by_role('row').filter(has_text=member).get_by_role('radio').check()
    work.get_by_role('button', name='Process selected record').click()
    expect(work.get_by_role('heading', name='MEMBERSHIP MASTER RECORD')).to_be_visible()
    expect(work.locator('.summary').get_by_role('cell', name=member, exact=True)).to_be_visible()
    return work


def fill_opening(work, member, product='SAV', amount='25.00', nickname='Rainy day'):
    work.locator('select[name="f01"]').select_option(product)
    work.locator('input[name="f02"]').fill(nickname)
    work.locator('select[name="f03"]').select_option(member+'-00')
    work.locator('input[name="f04"]').fill(amount)
    work.get_by_role('checkbox').check()


def review_value(work, label):
    return work.get_by_role('cell', name=label, exact=True).locator('..').get_by_role('cell').nth(1)


def opening(page, member='12345', product='SAV', amount='25.00', nickname='Rainy day'):
    work = lookup(page, member)
    work.get_by_role('link', name='31 — Share maintenance').click()
    fill_opening(work, member, product, amount, nickname)
    work.get_by_role('button', name='Transmit for review').click()
    expect(work.get_by_text('REVIEW CHECKPOINT', exact=False)).to_be_visible()
    return work


def diagnostic(page, code):
    page.get_by_role('link', name='99 Workstation diagnostics').click()
    work = page.frame_locator('iframe[name="work"]')
    work.locator('select[name="f01"]').select_option(code)
    work.get_by_role('button', name='Apply diagnostic').click()
    expect(work.get_by_text('Diagnostic accepted.', exact=False)).to_be_visible()


def test_browser_lookup_opening_nested_history_and_lost_response(browser_page):
    page = browser_page
    login(page)
    work = lookup(page, '12345')
    register = work.frame_locator('iframe[name="register"]')
    expect(register.get_by_text('2,450.75')).to_be_visible()
    register.get_by_role('radio').check()
    register.get_by_role('button', name='Retrieve history').click()
    expect(work.get_by_role('heading', name='SHARE DETAIL / POSTING HISTORY')).to_be_visible()
    diagnostic(page, 'lost_confirmation')
    work = opening(page)
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='POST SHARE + TRANSFER').click()
    expect(work.get_by_text('HOST-71:', exact=False)).to_be_visible()
    work.get_by_role('link', name='Retrieve / retry current screen').click()
    expect(work.get_by_text('Share account 12345-01 was opened', exact=False)).to_be_visible()
    work.get_by_role('link', name='12345-01', exact=True).click()
    expect(work.get_by_text('Initial share funding')).to_be_visible()
    expect(work.get_by_role('cell', name='25.00', exact=True)).to_have_count(3)
    work = lookup(page, '12345')
    register = work.frame_locator('iframe[name="register"]')
    expect(register.get_by_text('2,425.75')).to_be_visible()
    expect(register.get_by_text('12345-01')).to_be_visible()


def test_browser_human_approval_and_session_renewal(browser_page):
    page = browser_page
    login(page)
    work = opening(page, '12346')
    reference = review_value(work, 'Request reference').inner_text().strip()
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='POST SHARE + TRANSFER').click()
    expect(work.locator('[role="alert"]')).to_contain_text('SEC-40')
    work.get_by_role('link', name='Open supervisor authorization').click()
    work.get_by_label('Supervisor ID').fill('supervisor')
    work.get_by_label('Supervisor password').fill('Supervisor-demo-42!')
    work.get_by_role('button', name='Authorize this request').click()
    expect(work.get_by_text('Morgan / Supervisor', exact=False)).to_be_visible()
    expect(page.get_by_text('Casey / Operations', exact=False)).to_be_visible()
    # Keep the reviewed request while renewing the exact same browser session.
    diagnostic(page, 'access_expired')
    page.get_by_role('link', name='40 Work in process').click()
    work.get_by_role('button', name='Renew session').click()
    expect(work.get_by_role('heading', name='WORK IN PROCESS')).to_be_visible()
    work.get_by_role('link', name=reference, exact=True).click()
    expect(work.get_by_text('Morgan / Supervisor', exact=False)).to_be_visible()
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='POST SHARE + TRANSFER').click()
    expect(work.get_by_text('Share account 12346-01 was opened', exact=False)).to_be_visible()
    page.get_by_role('button', name='Sign off', exact=True).click()
    expect(page.get_by_label('Operator ID')).to_be_visible()


def test_browser_relogin_notes_contact_and_auditor_denial(browser_page):
    page = browser_page
    login(page)
    work = opening(page)
    diagnostic(page, 'session_expired')
    page.get_by_role('link', name='40 Work in process').click()
    work.get_by_label('Operator ID').fill('teller')
    work.get_by_label('Password', exact=True).fill('Teller-demo-42!')
    work.get_by_role('button', name='Establish session').click()
    expect(work.get_by_role('heading', name='WORK IN PROCESS')).to_be_visible()
    expect(work.get_by_role('cell', name='REVIEW', exact=True)).to_be_visible()
    work = lookup(page, '12345')
    work.get_by_role('link', name='02 Contact maintenance').click()
    work.locator('input[name="city"]').fill('Another Sample City')
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='Post contact maintenance').click()
    expect(work.get_by_text('Another Sample City', exact=False)).to_be_visible()
    work.get_by_role('link', name='03 Service notes').click()
    work.locator('textarea').fill('Synthetic member requested a follow-up.')
    work.get_by_role('button', name='Append note').click()
    expect(work.get_by_role('cell', name='Synthetic member requested a follow-up.')).to_be_visible()
    page.get_by_role('button', name='Sign off', exact=True).click()
    login(page, 'auditor', 'Auditor-demo-42!')
    work = lookup(page, '12345')
    work.get_by_role('link', name='31 — Share maintenance').click()
    expect(work.get_by_text('SEC-21:', exact=False)).to_be_visible()


def test_browser_review_contract_with_alternate_inputs(browser_page):
    page = browser_page
    login(page)
    references = []
    for member, amount, nickname, balance, name in [
        ('12345', '25.00', 'Rainy day', '2,450.75', 'Reed, Avery'),
        ('12348', '40.50', 'Trip fund', '2,501.75', 'Reed, Sam'),
    ]:
        work = opening(page, member, amount=amount, nickname=nickname)
        reference = review_value(work, 'Request reference').inner_text().strip()
        assert re.fullmatch(r'R[0-9A-F]{10}', reference)
        assert reference not in references
        references.append(reference)
        expect(review_value(work, 'State')).to_have_text('REVIEW')
        expect(review_value(work, 'Member / name')).to_have_text(f'{member} / {name}')
        expect(review_value(work, 'Share class')).to_have_text('SAV / Regular savings')
        expect(review_value(work, 'Description')).to_have_text(nickname)
        expect(review_value(work, 'Debit account')).to_have_text(member+'-00')
        expect(review_value(work, 'Opening funding USD')).to_have_text(amount)
        expect(work.get_by_role('cell', name='New account', exact=True)).to_have_count(0)
        # Review is the stopping boundary: verify unchanged money through the UI.
        work = lookup(page, member)
        register = work.frame_locator('iframe[name="register"]')
        expect(register.get_by_role('cell', name=balance, exact=True)).to_be_visible()
        expect(register.get_by_role('cell', name=member+'-01', exact=True)).to_have_count(0)
    page.get_by_role('link', name='40 Work in process').click()
    work = page.frame_locator('iframe[name="work"]')
    for reference in references:
        expect(work.get_by_role('link', name=reference, exact=True)).to_be_visible()
    work.get_by_role('link', name=references[1], exact=True).click()
    expect(review_value(work, 'Member / name')).to_have_text('12348 / Reed, Sam')
    expect(review_value(work, 'Opening funding USD')).to_have_text('40.50')


def test_browser_ambiguous_surname_selects_intended_member(browser_page):
    page = browser_page
    login(page)
    work = lookup(page, '12348', surname='Reed')
    expect(work.locator('.summary').get_by_role('cell', name='REED, Sam', exact=True)).to_be_visible()
    work.get_by_role('link', name='31 — Share maintenance').click()
    fill_opening(work, '12348', amount='40.50')
    work.get_by_role('button', name='Transmit for review').click()
    expect(review_value(work, 'Member / name')).to_have_text('12348 / Reed, Sam')


@pytest.mark.parametrize('member,outcome', [
    ('12347', 'MEM-04'), ('12349', 'FUN-02'), ('12350', 'SHR-08'),
])
def test_browser_business_outcomes(browser_page, member, outcome):
    page = browser_page
    login(page)
    work = lookup(page, member)
    work.get_by_role('link', name='31 — Share maintenance').click()
    # Closed members have no open funding options; submit the remaining valid fields.
    if member == '12347':
        work.locator('select[name="f01"]').select_option('SAV')
        work.locator('input[name="f02"]').fill('Rainy day')
        work.locator('input[name="f04"]').fill('25.00')
        work.get_by_role('checkbox').check()
    else:
        fill_opening(work, member)
    work.get_by_role('button', name='Transmit for review').click()
    expect(work.locator('[role="alert"]')).to_contain_text(outcome)
    page.get_by_role('link', name='40 Work in process').click()
    expect(work.get_by_text('No saved requests.', exact=False)).to_be_visible()


def test_browser_not_found_is_an_inquiry_result(browser_page):
    page = browser_page
    login(page)
    page.get_by_role('link', name='10 Member inquiry').click()
    work = page.frame_locator('iframe[name="work"]')
    work.locator('input[name="f01"]').fill('99999')
    work.get_by_role('button', name='Transmit', exact=True).click()
    expect(work.get_by_text('MEM-01:', exact=False)).to_be_visible()
    expect(work.get_by_role('heading', name='MEMBER INDEX INQUIRY')).to_be_visible()
    expect(work.get_by_role('radio')).to_have_count(0)


def test_browser_pending_request_is_resumed_not_duplicated(browser_page):
    page = browser_page
    login(page)
    work = opening(page)
    reference = review_value(work, 'Request reference').inner_text().strip()
    work = lookup(page, '12345')
    work.get_by_role('link', name='31 — Share maintenance').click()
    fill_opening(work, '12345')
    work.get_by_role('button', name='Transmit for review').click()
    expect(work.locator('[role="alert"]')).to_contain_text('SHR-09')
    expect(work.locator('[role="alert"]')).to_contain_text(reference)
    page.get_by_role('link', name='40 Work in process').click()
    expect(work.get_by_role('cell', name='REVIEW', exact=True)).to_have_count(1)
    work.get_by_role('link', name=reference, exact=True).click()
    expect(review_value(work, 'Member / name')).to_have_text('12345 / Reed, Avery')


@pytest.mark.parametrize('scenario', ['slow', 'app_error', 'dialog'])
def test_browser_bounded_inquiry_recovery(browser_page, scenario):
    page = browser_page
    login(page)
    diagnostic(page, scenario)
    page.get_by_role('link', name='10 Member inquiry').click()
    work = page.frame_locator('iframe[name="work"]')
    if scenario == 'app_error':
        expect(work.get_by_text('HOST-52:', exact=False)).to_be_visible()
        # One supported retry; no loop that hides a persistent failure.
        work.get_by_role('link', name='Retrieve / retry current screen').click()
    elif scenario == 'dialog':
        work.get_by_role('button', name='Acknowledge and return to inquiry').click()
        expect(work.locator('[role="alert"]')).to_have_count(0)
    expect(work.get_by_role('heading', name='MEMBER INDEX INQUIRY')).to_be_visible(timeout=8000)
    work.locator('input[name="f01"]').fill('12348')
    work.get_by_role('button', name='Transmit', exact=True).click()
    expect(work.get_by_role('row').filter(has_text='12348')).to_have_count(1)


def test_browser_stale_review_requires_cancel_and_new_request(browser_page):
    page = browser_page
    login(page)
    work = opening(page)
    original = review_value(work, 'Request reference').inner_text().strip()
    work = lookup(page, '12345')
    work.get_by_role('link', name='02 Contact maintenance').click()
    work.locator('input[name="city"]').fill('Revised Sample City')
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='Post contact maintenance').click()
    expect(work.get_by_text('Contact maintenance posted.')).to_be_visible()
    page.get_by_role('link', name='40 Work in process').click()
    work.get_by_role('link', name=original, exact=True).click()
    work.get_by_role('checkbox').check()
    work.get_by_role('button', name='POST SHARE + TRANSFER').click()
    expect(work.locator('[role="alert"]')).to_contain_text('MEM-09')
    work.get_by_role('button', name='Cancel request').click()
    expect(review_value(work, 'State')).to_have_text('CANCELLED')
    work = opening(page)
    expect(review_value(work, 'State')).to_have_text('REVIEW')
    assert review_value(work, 'Request reference').inner_text().strip() != original
