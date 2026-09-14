import os
import secrets
import hashlib
from pathlib import Path

from flask import Flask, render_template
from werkzeug.exceptions import HTTPException

from . import auth, db


def create_app(config=None, *, instance_path=None):
    config = dict(config or {})
    if instance_path is None and config.get('DATABASE'):
        instance_path = Path(config['DATABASE']).expanduser().resolve().parent
    explicit_instance = instance_path is not None
    app = Flask(__name__, instance_relative_config=True,
                instance_path=str(Path(instance_path).expanduser().resolve()) if explicit_instance else None)
    root = Path(app.instance_path)
    root.mkdir(parents=True, exist_ok=True)
    secret_path = root / 'signing.key'
    if not config.get('SECRET_KEY') and not secret_path.exists():
        try:
            with secret_path.open('x') as secret_file:
                os.chmod(secret_path, 0o600)
                secret_file.write(secrets.token_hex(32))
        except FileExistsError:
            pass
    # Browser cookies are shared across ports. Independent fixture directories
    # need independent cookie names, as well as separate databases and keys.
    namespace = 'meridian'
    if explicit_instance:
        namespace += '_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]
    app.config.from_mapping(
        SECRET_KEY=config.get('SECRET_KEY') or secret_path.read_text().strip(),
        DATABASE=str(root / 'meridian.sqlite3'),
        ACCESS_COOKIE_NAME=namespace + '_access', REFRESH_COOKIE_NAME=namespace + '_refresh',
        SESSION_COOKIE_NAME=namespace + '_preauth',
        ACCESS_TTL=300, REFRESH_TTL=8*3600, IDLE_TTL=1800,
        COOKIE_SECURE=False, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
        MAX_CONTENT_LENGTH=32*1024, TRUSTED_HOSTS=['localhost', '127.0.0.1', '[::1]'],
    )
    if config:
        app.config.update(config)
    app.teardown_appcontext(db.close_db)
    app.before_request(auth.guard)
    app.context_processor(lambda: {'csrf_token': auth.csrf_token, 'products': db.PRODUCTS})
    app.jinja_env.filters['money'] = lambda cents: f'{cents / 100:,.2f}'
    app.register_blueprint(auth.bp)
    from .views import bp
    app.register_blueprint(bp)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'"
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return render_template('error.html', code=error.code, message=error.description), error.code

    db.initialize(app)
    return app
