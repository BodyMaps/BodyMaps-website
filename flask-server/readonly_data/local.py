"""Start a local-only BodyMaps backend or frontend with an isolated test state."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys


def local_environment(snapshot, state, inherited=None):
    snapshot, state = Path(snapshot).resolve(strict=True), Path(state).absolute()
    if (snapshot / "INCOMPLETE").exists() or not (snapshot / "PanTS/metadata.xlsx").is_file():
        raise ValueError("Use a completed dataset snapshot")
    if json.loads((snapshot / "snapshot.json").read_text())["schema"] != 1:
        raise ValueError("Unsupported snapshot")
    # Do not inherit production credentials, URLs, filesystem paths or worker keys.
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PATHEXT", "COMSPEC", "LANG", "LC_ALL", "CONDA_PREFIX"}
    source = os.environ if inherited is None else inherited
    env = {k: v for k, v in source.items() if k.upper() in allowed}
    env.update({
        "PYTHON_DOTENV_DISABLED": "1", "FLASK_SKIP_DOTENV": "1",
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8",
        "PANTS_PATH": str(snapshot / "PanTS"), "CANCERVERSE_PATH": "",
        "CANCERVERSE_LOWRES_PATH": str(state / "lowres-cv"),
        "PANTS_LOWRES_PATH": str(state / "lowres"),
        "DATABASE_URL": "sqlite:///" + (state / "test.db").as_posix(),
        "SESSIONS_DIR_PATH": str(state / "sessions"),
        "PERMISSIONS_DIR": str(state / "data"), "MESH_PATH": str(snapshot / "meshes"),
        "BODYMAPS_UPLOAD_CHUNK_DIR": str(state / "uploads"),
        "USER_DATASET_PATH": str(state / "user-dataset"),
        "BODYMAPS_ACCEL_REDIRECT_ENABLED": "false", "EPAI_REMOTE_ENABLED": "false",
        "BASE_PATH": "/", "USE_SSL": "false", "TRUST_PROXY": "false",
        "PUBLIC_BASE_URL": "http://127.0.0.1:5173", "FRONTEND_URL": "http://127.0.0.1:5173",
        "ALLOWED_ORIGINS": "http://127.0.0.1:5173,http://localhost:5173",
        "OLLAMA_BASE_URL": "http://127.0.0.1:11434", "SMTP_HOST": "", "SMTP_USER": "", "SMTP_PASSWORD": "",
        "GOOGLE_CLIENT_ID": "", "GOOGLE_CLIENT_SECRET": "", "GITHUB_CLIENT_ID": "", "GITHUB_CLIENT_SECRET": "",
        "VITE_API_BASE": "", "VITE_PROXY_TARGET": "http://127.0.0.1:5001",
        "VITE_WS_BASE": "ws://127.0.0.1:8001",
        "VITE_BASENAME": "/",
    })
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=["backend", "frontend"])
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--state", required=True, help="Local test database/output directory")
    args = parser.parse_args()
    # Older dotenv versions do not honor the global disable switch.
    version = tuple(int(p) for p in importlib.metadata.version("python-dotenv").split(".")[:2])
    if version < (1, 2):
        raise SystemExit("Install the pinned backend requirements (python-dotenv >= 1.2 required)")
    env = local_environment(args.snapshot, args.state)
    state = Path(args.state).absolute()
    state.mkdir(parents=True, exist_ok=True)
    for folder in ("sessions", "data", "uploads", "user-dataset"):
        (state / folder).mkdir(exist_ok=True)
    key = state / "session-secret"
    if not key.exists():
        with key.open("x", encoding="utf-8") as stream:
            stream.write(secrets.token_hex(32))
        key.chmod(0o600)
    env["SECRET_KEY"] = key.read_text(encoding="utf-8").strip()
    backend = Path(__file__).resolve().parents[1]
    if args.component == "backend":
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend, env=env, check=True)
        command = [sys.executable, "-m", "flask", "--app", "app:app", "run", "--host", "127.0.0.1", "--port", "5001", "--no-debugger", "--no-reload"]
        cwd = backend
    else:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise SystemExit("Install Node.js and run npm ci in PanTS-Demo first")
        command = [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]
        cwd = backend.parent / "PanTS-Demo"
    print(f"Local {args.component}; test state: {state}. Production credentials are not inherited.", flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


if __name__ == "__main__":
    main()
