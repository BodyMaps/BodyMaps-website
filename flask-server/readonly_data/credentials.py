"""Create a local secret and a non-secret grant for an administrator to approve."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import time

from .service import case_id


def prepare_grant(cases, days, token_file, grant_file):
    identifiers = sorted({case_id(value) for value in cases})
    if not 1 <= days <= 30 or not 1 <= len(identifiers) <= 100:
        raise ValueError("Choose 1-100 cases and an expiry of 1-30 days")
    token_file, grant_file = Path(token_file), Path(grant_file)
    if token_file.exists() or grant_file.exists() or token_file.absolute() == grant_file.absolute():
        raise ValueError("Use two new files; existing credentials are never overwritten")
    token = secrets.token_urlsafe(48)
    grant = {"sha256": hashlib.sha256(token.encode()).hexdigest(), "cases": identifiers,
             "expires_at": int(time.time()) + days * 86400}
    # On Windows, put this in a private user directory and check the ACL.
    with os.fdopen(os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        stream.write(token + "\n")
    with grant_file.open("x", encoding="utf-8") as stream:
        json.dump(grant, stream, indent=2)
    return grant


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--grant-file", required=True)
    args = parser.parse_args()
    prepare_grant(args.cases.split(","), args.days, args.token_file, args.grant_file)
    print("Files created. Send only the grant file to the administrator for approval.")
    print("Access is disabled until the administrator installs that grant.")


if __name__ == "__main__":
    main()
