# Portable source fixture

The portal lives in awl's `dummy/` directory as ordinary source files. It has no nested Git repository or separate history. It runs independently of awl with Python 3.12+ and uv.

## Share the source

From the `dummy/` directory, create an archive containing only source, dependency declarations, tests, and documentation:

```sh
mkdir -p dist
tar --exclude='__pycache__' --exclude='*.pyc' -czf dist/member-servicing-portal.tar.gz .gitignore README.md pyproject.toml uv.lock run.py portal tests docs
```

The local `instance/`, `fixtures/`, virtual environment, and environment files are excluded by the explicit source list. Do not include them separately: they can contain databases, signing keys, and session data. Dependencies are installed from `uv.lock`, not copied into the archive.

## Run a fresh fixture

Extract the archive into an empty directory, then run:

```sh
uv sync --locked
uv run python run.py --instance-dir fixtures/first-run --port 7311
```

Open `http://127.0.0.1:7311` and use the README's public training operators. Reusing the fixture directory preserves its state; choose a new directory for a fresh baseline.

The archive contains synthetic fixture definitions, not a recording of another operator's session. Source availability and included tests do not establish a passing CI run or successful automation evidence.
