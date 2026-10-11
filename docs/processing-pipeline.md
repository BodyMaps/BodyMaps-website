# Optional CT reconstruction and organ refinement

The workspace can request a real server pipeline: optional OpenVAE reconstruction, a supported segmentation model, optional ShapeKit organ refinement, then result packaging. View-only mode remains local to the browser and runs none of these server stages.

The supported segmentation models for optional stages are **ePAI, Atlas-Net, and LesionSegmenter**. Other existing model endpoints do not imply that their native labels are compatible with ShapeKit. In particular, the current MedIA vertebral label scheme is outside this pipeline's allowlist.

## What the stages mean

| Stage | Input and result | Scope |
| --- | --- | --- |
| OpenVAE | Original CT to a separately stored reconstructed CT | The actual JHU inference script clips CT intensities to **[-1000, 1000] HU** during reconstruction. Reconstruction is not a demonstrated clinical quality improvement and may change image intensities. |
| Segmentation | Original CT, or reconstructed CT when OpenVAE was selected, to viewer-space labels | The chosen segmentation model determines the labels. Missing detections do not establish that an organ is healthy. |
| ShapeKit | Compatible segmentation to refined whole-organ masks | Refines supported organs only. Lesions and other unsupported labels are preserved; LesionSegmenter pancreas subregions are not silently merged into a whole-pancreas mask. |
| Packaging | Validated final labels and explicit provenance to the result archive | The job becomes completed only after its selected stages and packaging succeed. |

The original uploaded CT is retained unchanged. The viewer continues to use it as its CT reference, preserving the original attenuation values. A reconstructed CT is stored separately and served only through the owner-protected reconstruction endpoint. Pipeline metadata records `segmentation_input` as `original` or `reconstruction` and `viewer_reference` as `original`.

Reconstruction and masks must match the original CT dimensions and affine and contain finite values. Segmentation labels must be valid integers in the supported viewer scheme. The pipeline rejects incompatible geometry rather than relabelling a shifted image as successful.

## Install the actual OpenVAE checkpoint

OpenVAE requires its own source/runtime and the actual checkpoint. A missing checkpoint is an unavailable stage; the adapter does **not** substitute MAISI or another model.

The download helper pins this official artifact:

| Field | Pinned value |
| --- | --- |
| Repository | [SMILE-project/OpenVAE](https://huggingface.co/SMILE-project/OpenVAE) |
| Revision | `d0cb74be63bcc4d59ea56e01dacbbdff0ec11e6d` |
| File | `OpenVAE-3D-4x-patch64-10K/autoencoder_best.pt` |
| Size | `83,831,747` bytes, approximately **80 MiB** |
| SHA-256 | `4d93e824397797fc6458ace25c9a08cad8ab3ca53e2a890ba357c3e62632adcb` |

From `flask-server`, run the helper explicitly under the account that will own the checkpoint, choosing the destination file:

```bash
python scripts/fetch_openvae_checkpoint.py \
  --destination "$HOME/openvae/ckpt/OpenVAE-3D-4x-patch64-10K/autoencoder_best.pt"
```

The helper streams to its own temporary file beside the destination, checks the exact size and SHA-256, then publishes the complete file with an atomic hard link. A matching existing checkpoint is accepted without a network request. A mismatching existing file, a directory, or a symbolic link is never overwritten. If another process creates a different destination during download, that file is preserved and the command fails. A filesystem without hard-link support fails safely; there is no overwrite fallback. Failed or interrupted downloads remove only the helper's own temporary file.

This command downloads a file only. It does not load the checkpoint, edit configuration, install packages, run GPU inference, or restart services. Configure the approved runtime separately:

| Setting | Meaning |
| --- | --- |
| `OPENVAE_SRC_PATH` | OpenVAE source directory containing `test/test_3dvae.py` |
| `OPENVAE_CHECKPOINT_PATH` | Absolute path of the verified `autoencoder_best.pt` |
| `CONDA_ENV_OPENVAE` | Existing OpenVAE environment name, default `openvae` |
| `SHAPEKIT_SRC_PATH` | ShapeKit source directory containing `main.py` |
| `CONDA_ENV_SHAPEKIT` | Existing ShapeKit environment name, default `shapekit` |
| `SHAPEKIT_CPU_NUM` | ShapeKit worker setting, default `16`; size for the approved server |

The server capability check verifies local source, checkpoint, and runtime availability. It is a preflight check, not proof of a successful GPU run or segmentation accuracy.

## Server state, ownership, and artifacts

Requests use the existing authenticated inference endpoint with `preprocessing` set to `OpenVAE` or empty, and `postprocessing` set to `ShapeKit` or empty. The server validates supported model combinations, stage availability, ownership, and account access. Client-supplied filesystem paths remain rejected. An accepted pipeline counts as one scan; its internal stages are not independently charged as additional scans.

The durable job stores the pipeline selection and actual stage transitions. Stage IDs are `preprocessing`, `segmentation`, `postprocessing`, and `packaging`; unselected optional stages are omitted and can be shown as “Skipped” from the explicit selection. Legacy jobs with no pipeline metadata do not prove that an optional stage ran. The UI uses measured upload transfer and real server state, not timer-generated model percentages.

Each attempt uses separate stage directories below `pipeline/<unique-attempt>/`. The raw segmentation is retained. When ShapeKit is selected, the final output contains:

```text
combined_labels.nii.gz              final refined viewer labels
pipeline.json                      selected stages and provenance
segmentation_original/
  combined_labels.nii.gz            model output before refinement
  output.csv                       raw model measurements, when produced
```

`pipeline.json` identifies raw measurements as `segmentation_original` when refinement was selected. A pre-refinement CSV must not be presented as measurements of the refined final mask. Without refinement, an existing model-produced CSV describes its unrefined segmentation; not every model produces a CSV. The reconstructed CT is separate from this mask archive.

The final output directory is published only after the selected pipeline and archive succeed. Both the segmentation endpoint and session meshes use that final output. Failed or cancelled pipelines must retain their terminal state and must not offer a partial result as a completed pipeline. Cancellation applies to the same owned session throughout all selected stages.

## Verification before release

Local mocked tests cover the orchestration and download helper, including corrupt/truncated downloads, no-clobber publication races, and cleanup. They do not download weights or validate the GPU models.

Before enabling these stages in a release, run an **isolated GPU integration test** using an approved CT and separate test sessions/storage. Exercise each advertised model and enabled stage combination. Confirm the original CT bytes remain unchanged, reconstruction and masks retain the original geometry, protected labels survive refinement, the viewer and archive use the same final mask, and raw measurements remain labelled as provenance. Also verify cancel/failure, retry, unavailable dependencies, ownership denial, restart/history recovery, and the stage display in the approved Chrome profile.

Record checkpoint identity, model/runtime versions, selected stages, outcomes, and measured timings. Successful execution alone does not establish improved accuracy, clinical validity, or a quantified speedup. Complete the required local design review before any production deployment.
