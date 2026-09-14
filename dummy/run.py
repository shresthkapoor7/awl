import argparse
from waitress import serve
from portal import create_app


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Run the local Meridian Member Services portal.')
    parser.add_argument('--port', type=int, default=7310)
    parser.add_argument('--instance-dir', help='Directory for this fixture database and signing key. Existing data is preserved.')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    return args


if __name__ == '__main__':
    args = parse_args()
    app = create_app(instance_path=args.instance_dir)
    print(f'Meridian Member Services: http://127.0.0.1:{args.port}', flush=True)
    print(f'Fixture directory: {app.instance_path}', flush=True)
    serve(app, host='127.0.0.1', port=args.port, threads=6)
