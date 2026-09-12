"""Serve locally prepared fixtures. Usage: python serve_anatomy_fixture.py DIRECTORY"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def do_GET(self):
        parts = self.path.strip('/').split('/')
        if len(parts) == 4 and parts[:2] in (['api', 'cases'], ['api', 'sessions']) and parts[-1] == 'mesh-manifest':
            self.path = f'/{parts[2]}/manifest.json'
        super().do_GET()
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
ThreadingHTTPServer(('127.0.0.1', 5001), Handler).serve_forever()
