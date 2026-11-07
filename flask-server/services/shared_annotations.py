"""Where the shared (everyone sees it) version of a PanTS scan's segmentation lives.

An approved annotator's "Save to JHU server" writes one labelmap per scan under
``<viewer label cache>/edits/shared/<PanTS_########>/``; every reader of a dataset mask resolves
through ``api.api_blueprint._pants_viewer_mask_path``, which prefers it over the original. This
module is only the path rule, kept free of Flask so ``api.utils`` (organ statistics, staging) can ask
the same question without importing the blueprint.

The file is in the viewer's label ids already, so a reader must not run the source-to-viewer
conversion on it.
"""

import os

from constants import Constants


def viewer_cache_root() -> str:
    return os.environ.get("PANTS_VIEWER_LABEL_CACHE_PATH") or os.path.join(Constants.PERMISSIONS_DIR, "pants_viewer_labels")


def shared_mask_path(pants_id: str, low: bool = False) -> str:
    filename = "combined_labels_lowres.nii.gz" if low else "combined_labels.nii.gz"
    return os.path.join(viewer_cache_root(), "edits", "shared", pants_id, filename)


def existing_shared_mask(pants_id: str) -> str | None:
    """The shared full-resolution mask for ``PanTS_########``, or None while the original is shown."""
    path = shared_mask_path(pants_id)
    return path if os.path.isfile(path) else None
