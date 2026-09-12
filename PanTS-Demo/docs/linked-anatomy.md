# Linked CT planes in the anatomy viewer

Inspired by the interactive anatomy demo [shared by Ali Rezaei](https://lnkd.in/p/ezMXpyzg): relate a CT section to the patient's three-dimensional anatomy while moving the section or selecting an organ. This is an implementation in BodyMaps' existing viewer, not imported source from that demo.

The mesh pane now offers:

- Individual axial, coronal, and sagittal CT planes, or all three together.
- Oblique axial tilt around the left/right and anterior/posterior axes, pivoting at the linked crosshair.
- Slice position controls that move the underlying Cornerstone viewport. Existing CT window/level, scrolling, and native oblique changes update the plane texture after rendering.
- Organ selection from a mesh or the existing organ navigation: label the selection, keep it opaque, and fade surrounding visible organs. Clear focus restores the global opacity. Custom organ meshes also support picking.
- Double-click a CT plane to move the shared crosshair to the picked physical point.
- Patient orientation cube, scan bounds, reset, and collapsible interaction guidance.

The CT plane is the actual Cornerstone output, including any visible segmentation overlay. Its four texture corners come from `canvasToWorld` in CSS pixels, then use the same LPS-to-centered-Three transform as the organ meshes. Window/level is not approximated with another resampler. Texture resolution is capped at 768 pixels on its longer edge; this only limits the 3D preview, not the source CT pane. Image listeners, frame callbacks, textures, and geometry are released on unmount. The existing volume-rendering mode is unchanged.

## Verification

- All 332 frontend tests passed across 53 test files. The ten targeted tests cover: physical coordinate inversion, patient axes, orthonormal oblique cameras, pivot-preserving camera updates, control behavior/subscription cleanup, and the existing viewer page smoke tests.
- TypeScript and production build passed. Build reports the existing codec externalization and chunk-size warnings.
- ESLint passed for changed rendering files (zero errors; existing warnings in the mesh components remain).
- The [browser harness](../tests/browser/README.md) ran the real Cornerstone and Three.js renderers against two local TotalSegmentator CT/spleen pairs (`s1989`, `s1737`), subsampled with an affine update. These are supplied reference masks, not model predictions.
- Both cases passed organ selection/clear, pixel-and-geometry changes on slice movement, window/level texture updates, two-axis oblique rotation without moving its pivot, plane picking, reset, separate coronal/sagittal controls, all-three mode, and the production screenshot helper.
- Maximum observed plane-corner coordinate error: 0.000017 mm (Float32 geometry rounding). Plane-pick verification used the UI's one-decimal-mm readout, agreeing within its 0.05 mm rounding precision.
- Switching cases detached the old canvas, loaded a different CT volume and GLB/manifest, reset the controls, and cleared focus. The new case then passed the same interaction audit.

The browser audit is in `PanTS-Demo/tests/browser/anatomy-audit.ts`. Production deployment and broad device/browser validation are separate from these local checks. No new segmentation accuracy or clinical-performance claim is made by this rendering change.
