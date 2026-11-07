# Annotator access: saving corrections for everyone

Approved people can fix a dataset scan's segmentation and save it as the version **everyone** sees
(viewer button **Save to JHU server**, above the normal **Save**, shown only to them, only on PanTS cases).
The normal **Save** still keeps an edit on the person's own account.

## Who is approved

The `annotator` role (admins can also save). Two ways to get it:

1. **Invitation code.** Settings > Profile > Invitation code. The server compares it with the SHA-256 digests in
   `BODYMAPS_ANNOTATOR_INVITE_SHA256` (comma-separated, so several codes can exist and one can be withdrawn):

   ```bash
   printf '%s' 'the-long-random-code' | sha256sum        # use a long random code; attempts are limited per account and IP
   # flask-server/.env:  BODYMAPS_ANNOTATOR_INVITE_SHA256=<digest>[,<digest>...]
   ```

   Restart the backend after changing the variable. Redeeming is idempotent and grants nothing but `annotator`.
2. **An admin** (Settings > People > Make annotator / Remove annotator).

## Where the corrected version lives

Under the viewer label cache (`PANTS_VIEWER_LABEL_CACHE_PATH`, default `<PERMISSIONS_DIR>/pants_viewer_labels`):

| What | Path |
| --- | --- |
| shared mask | `edits/shared/PanTS_########/combined_labels.nii.gz` (+ `meta.json`: version, who, when) |
| replaced versions | `edits/shared-history/PanTS_########/<UTC timestamp>.nii.gz` (newest 20 kept) |
| shared 3D meshes | `<MESH_PATH>/shared/PanTS_########/` |

The dataset's own `mask_only/` is read-only and never touched. Every reader that shows a mask (2D masks, low-res
preview, 3D meshes, organ statistics, PDAC staging) prefers the shared mask over the original; a person's own saved
edit still wins for that person.

## Undoing a bad correction

- In the app: an annotator can call `DELETE /api/shared-annotation/<case>` (everyone sees the original again; the
  removed version is archived).
- By hand: copy a file from `shared-history/` back to `edits/shared/PanTS_########/combined_labels.nii.gz`. Meshes and
  statistics refresh themselves (they are keyed by the file's revision).

## Not covered yet

Per-organ source files that PDF reports and report measurements read (`mask_only/<case>/segmentations/*.nii.gz`) are not
rewritten, so those still describe the original annotation.
