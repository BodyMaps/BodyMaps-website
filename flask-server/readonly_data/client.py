"""Copy approved cases to a NEW local snapshot. No upload or proxy operation exists."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
from openpyxl import Workbook

from .service import MESH_RE, case_id


def validate_server(url):
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("Use an origin URL without credentials, paths or query parameters")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise ValueError("HTTPS is required except for a loopback SSH tunnel")
    if not parsed.hostname:
        raise ValueError("Server hostname is required")
    return url.rstrip("/")


def asset_relative(identifier, asset):
    identifier = case_id(identifier)
    paths = {
        "ct": f"PanTS/image_only/{identifier}/ct.nii.gz",
        "mask": f"PanTS/mask_only/{identifier}/combined_labels.nii.gz",
        "thumbnail": f"PanTS/profile_only/{identifier}/profile.jpg",
        "mesh-manifest": f"meshes/{identifier}/manifest.json",
    }
    if asset in paths:
        return paths[asset]
    if MESH_RE.fullmatch(asset):
        return f"meshes/{identifier}/{asset}"
    raise ValueError("Unexpected asset name")


def fetch_snapshot(server, token_file, identifiers, output, max_bytes=10 * 1024**3):
    server = validate_server(server)
    identifiers = list(dict.fromkeys(case_id(value) for value in identifiers))
    if not identifiers or len(identifiers) > 100 or max_bytes <= 0:
        raise ValueError("Select 1–100 approved cases and a positive size limit")
    token = Path(token_file).read_text(encoding="utf-8").strip()
    if not 32 <= len(token) <= 256:
        raise ValueError("Invalid developer token file")
    output = Path(output).absolute()
    # Exclusive creation prevents overwriting snapshots, edited masks or results.
    output.mkdir(parents=True, exist_ok=False)
    (output / "INCOMPLETE").write_text("Download not finished; do not use this snapshot.\n")
    session = requests.Session()
    session.trust_env = False  # No ambient proxy or .netrc credentials.
    session.headers["Authorization"] = "Bearer " + token
    total = 0
    descriptions = []
    try:
        def get(path, **kwargs):
            for attempt in range(3):
                response = session.get(server + path, allow_redirects=False, timeout=(10, 120), **kwargs)
                if response.status_code != 429 or attempt == 2:
                    break
                response.close()
                time.sleep(60)
            if response.status_code != 200:
                response.close()
                raise RuntimeError(f"Read service returned HTTP {response.status_code}; no redirects are followed")
            return response

        for identifier in identifiers:
            with get(f"/v1/cases/{identifier}") as response:
                description = response.json()
            if description.get("schema") != 1 or description.get("case_id") != identifier:
                raise ValueError("Unexpected case metadata")
            if not {"ct", "mask"} <= description["assets"].keys():
                raise ValueError(f"{identifier} needs an existing CT and combined mask")
            descriptions.append(description)
            for asset, info in description["assets"].items():
                expected = int(info["bytes"])
                if expected < 0 or total + expected > max_bytes:
                    raise ValueError("Snapshot exceeds the configured download limit")
                destination = output / asset_relative(identifier, asset)
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix(destination.suffix + ".part")
                written = 0
                with get(f"/v1/cases/{identifier}/assets/{asset}", stream=True) as response, temporary.open("xb") as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        written += len(chunk)
                        if written > expected or total + written > max_bytes:
                            raise ValueError("Asset size exceeded its declared limit")
                        handle.write(chunk)
                if written != expected:
                    raise ValueError("Incomplete asset download")
                total += written
                temporary.replace(destination)
            print(f"Fetched {identifier}", flush=True)
        columns = descriptions[0]["columns"]
        if any(d["columns"] != columns or len(d["row"]) != len(columns) for d in descriptions):
            raise ValueError("Inconsistent metadata columns")
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "PanTS_metadata"
        for values in [columns] + [d["row"] for d in descriptions]:
            sheet.append(values)
            # Treat spreadsheet strings as literal data, never formulas.
            for cell in sheet[sheet.max_row]:
                if isinstance(cell.value, str):
                    cell.data_type = "s"
        workbook.save(output / "PanTS" / "metadata.xlsx")
        (output / "snapshot.json").write_text(json.dumps({"schema": 1, "cases": identifiers, "bytes": total}, indent=2), encoding="utf-8")
        (output / "INCOMPLETE").unlink()
        return output
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://127.0.0.1:8766")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--cases", required=True, help="Comma-separated approved PanTS IDs")
    parser.add_argument("--output", required=True, help="A new local directory; existing directories are refused")
    parser.add_argument("--max-gb", type=float, default=10)
    args = parser.parse_args()
    result = fetch_snapshot(args.server, args.token_file, args.cases.split(","), args.output, int(args.max_gb * 1024**3))
    print(f"Complete local snapshot: {result}")


if __name__ == "__main__":
    main()
