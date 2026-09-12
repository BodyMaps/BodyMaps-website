"""Serve local scan fixtures for both the real /case route and renderer harness."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import sys

root = Path(sys.argv[1]).resolve()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def route(self):
        parts = urlsplit(self.path).path.strip('/').split('/')
        if len(parts) == 4 and parts[:2] in (['api', 'cases'], ['api', 'sessions']) and parts[-1] == 'mesh-manifest':
            self.path = f'/{parts[2]}/manifest.json'
        elif len(parts) == 3 and parts[0] == 'api' and parts[1] in ('get-main-nifti', 'get-segmentations'):
            case = parts[2].removesuffix('.nii.gz')
            filename = 'ct.nii.gz' if parts[1] == 'get-main-nifti' else 'seg.nii.gz'
            self.path = f'/{case}/{filename}'

    def json_response(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        responses = {'/api/auth/me': {'user': None}, '/api/auth/oauth/providers': {},
                     '/api/search': {'items': []}}
        if path in responses:
            return self.json_response(responses[path])
        self.route()
        super().do_GET()

    def do_HEAD(self):
        self.route()
        super().do_HEAD()

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if urlsplit(self.path).path == '/api/mask-data':
            return self.json_response({'organ_metrics': []})
        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5178')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
        super().end_headers()

ThreadingHTTPServer(('127.0.0.1', 5001), Handler).serve_forever()
