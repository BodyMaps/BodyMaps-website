"""Print the scans that may be used for training, as JSON.

Only the scans of projects whose ``allow_training`` switch an admin has turned on are listed, and nothing else: a project that
has not allowed it never appears here, and neither does anything from the shared library. Each entry has the project, the
case id, the modality (ct or mri) and the file.

    python scripts/project_training_manifest.py            # to the screen
    python scripts/project_training_manifest.py --out m.json

Reads the website's database and PROJECT_DATASET_PATH (from the same .env the website uses); it changes nothing.
"""
import argparse
import json
import os
import sys

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVER)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=None, help="write the manifest to this file instead of the screen")
    args = parser.parse_args(argv)
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(SERVER, ".env"))
    except ImportError:
        pass
    from services import project_data
    manifest = project_data.training_manifest()
    text = json.dumps(manifest, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
        print(f"{len(manifest)} scans from {len({m['project_id'] for m in manifest})} projects written to {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
