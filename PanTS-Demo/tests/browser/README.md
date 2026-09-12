# Linked anatomy browser verification

Run the actual Cornerstone and Three.js renderers on local, aligned CT and organ-mask NIfTI files. The harness calls the production viewer components and coordinate transforms; it does not mock the CT images or WebGL. It is outside the production build and contains no scan data.

Prepare two different cases (a binary mask uses `--label-value 1`):

```sh
uv run --with nibabel --with scikit-image --with trimesh python tests/browser/prepare_anatomy_fixture.py /path/ct.nii.gz /path/organ.nii.gz /tmp/bodymaps-anatomy
uv run --with nibabel --with scikit-image --with trimesh python tests/browser/prepare_anatomy_fixture.py /path/second-ct.nii.gz /path/second-organ.nii.gz /tmp/bodymaps-anatomy --case fixture-b
python tests/browser/serve_anatomy_fixture.py /tmp/bodymaps-anatomy
```

In another terminal, `VITE_API_BASE=http://127.0.0.1:5001 npm run dev -- --host 127.0.0.1 --port 5178`, then open `/case/fixture` for the actual BodyMaps page. Verify axial at top left, sagittal at top right, coronal at bottom left, and 3D at bottom right. Open CT planes beside Meshes/Volume in the existing 3D toolbar. Use this full page for review screenshots. The API fixture supplies reference CT, segmentation and meshes; authentication and metadata are stubbed without invented patient information.

For isolated renderer-coordinate diagnostics only, open `/tests/browser/anatomy.html`. Its layout is a test harness, not the website design. No authentication or inference jobs are needed. Use a separate local API port if 5001 is already occupied, updating the harness/fixture asset URL accordingly.

Check all three planes, slice scrolling, both oblique tilt sliders, organ selection/clear, plane double-click to move the crosshair, orientation cube, and reset. Change CT window/level through the real viewport API and confirm that its texture updates. Switch the fixture case while planes are visible and verify that neither the first organ nor its CT remains. The test-only `window.anatomyTest` exposes the actual Cornerstone engine, Three scene, and production screenshot helper for physical-coordinate and pixel checks.

Targeted automated checks:

```sh
npm test -- src/helpers/viewer/anatomyGeometry.test.ts src/components/viewer/AnatomyControls.test.tsx src/test/viewer.smoke.test.tsx
npm run build
```

The fixture is labeled generically: its label is a supplied organ mask, not a model prediction or an accuracy claim. Keep generated NIfTI/GLB files outside the repository.

With the harness visible and loaded, run this in its browser console to perform the interaction and coordinate audit:

```js
(await import('/tests/browser/anatomy-audit.ts')).auditAnatomy()
```

Run it again after switching cases. It dispatches browser pointer events through the actual mesh raycaster, checks the linked CT cameras and textures, and validates the production screenshot helper. The tests wait for rendered frames instead of assuming that a fixed timer guarantees an updated GPU texture.
