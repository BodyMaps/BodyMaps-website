# AtlasNet: server setup

What has to exist on the inference box before the `AtlasNet-Organs` option in the upload
dropdown will do anything. Nothing here touches the website deploy; it only puts a model and an
environment on disk.

Roughly twenty minutes, most of it a download.

## What the code expects

`_run_atlasnet_organs_inference` in `services/auto_segmentor.py` shells out to nnU-Net inside a
conda env. It reads two things from the environment and hardcodes nothing:

| Variable | Default | What it points at |
|---|---|---|
| `ATLASNET_ORGANS_MODEL_PATH` | `/home/visitor/atlasnet_organs/nnUNetTrainer__nnUNetPlannerResEncL_torchres_isotropic__3d_fullres` | the unzipped nnU-Net **trainer directory** |
| `CONDA_ENV_ATLASNET_ORGANS` | `atlasnet` | conda env with nnU-Net v2 installed |

Optional, only if you keep nnU-Net's scratch dirs somewhere specific:
`ATLASNET_ORGANS_NNUNET_RAW`, `_PREPROCESSED`, `_RESULTS`.

If the model directory is missing the runner raises a clear error naming the path, rather than
failing somewhere deep inside nnU-Net.

## 1. Weights

The release is a bare nnU-Net model folder, **not** an `nnUNet_results` tree. That is why the
env var points straight at the trainer directory.

```bash
mkdir -p /home/visitor/atlasnet_organs && cd /home/visitor/atlasnet_organs
curl -L -O https://huggingface.co/AbdomenAtlas/AtlasNet/resolve/main/AbdomenAtlasNetOrgans.zip
unzip -q AbdomenAtlasNetOrgans.zip && rm AbdomenAtlasNetOrgans.zip
```

About 1.5 GB down, 1.6 GB on disk. You should end up with:

```
/home/visitor/atlasnet_organs/
└── nnUNetTrainer__nnUNetPlannerResEncL_torchres_isotropic__3d_fullres/
    ├── dataset.json
    ├── plans.json
    └── fold_all/
        ├── checkpoint_final.pth      # the runner uses this one
        └── checkpoint_best.pth
```

The zip also carries training logs and a `progress.png`; harmless, ignore them.

## 2. Conda env

**On bdmap1 there is already an `atlasnet` env** (torch 2.11+cu130, nnunetv2) built for that
box, which is GB10 / aarch64. Use it rather than making a new one. Both models point at it by
default via `CONDA_ENV_ATLASNET_ORGANS` / `_TUMORS`.

Only if you are setting this up somewhere else:

```bash
conda create -y -n atlasnet python=3.11
conda activate atlasnet
# pick the wheel that matches the box. cu121 x86 wheels will NOT work on
# aarch64 / Grace-Blackwell; that hardware needs a cu13x aarch64 build.
pip install torch --index-url https://download.pytorch.org/whl/cu130
pip install nnunetv2
```

Sanity check, should print a version and `True`:

```bash
python -c "import torch, nnunetv2; print(torch.__version__, torch.cuda.is_available())"
```

## 3. Point the app at it

Only needed if the paths differ from the defaults in the table above. Set them wherever the
other model vars live (`CONDA_ENV_EPAI` and friends), then restart the backend.

## 4. Verify without going through the website

```bash
conda activate atlasnet
export nnUNet_raw=/tmp/nn/raw nnUNet_preprocessed=/tmp/nn/pre nnUNet_results=/tmp/nn/res
mkdir -p /tmp/nn/{raw,pre,res} /tmp/atlas_in /tmp/atlas_out

# any CT, but the filename must end _0000.nii.gz or nnU-Net ignores it
cp /path/to/scan.nii.gz /tmp/atlas_in/CASE_0000.nii.gz

nnUNetv2_predict_from_modelfolder \
  -i /tmp/atlas_in -o /tmp/atlas_out \
  -m /home/visitor/atlasnet_organs/nnUNetTrainer__nnUNetPlannerResEncL_torchres_isotropic__3d_fullres \
  -f all -chk checkpoint_final.pth
```

Then confirm the labels are what the viewer expects. Should print a subset of 1 to 34:

```bash
python -c "
import nibabel as nib, numpy as np
d = np.asarray(nib.load('/tmp/atlas_out/CASE.nii.gz').dataobj)
print(sorted(set(np.unique(d).tolist())))"
```

Anything outside 1 to 34, or a suspiciously sparse set, means something is wrong: stop and
tell me rather than wiring it up. (The *Tumors* checkpoint from the same release is
region-based and does emit a sparse set. This one should not.)

## Resource notes

Measured on one A100-40GB against a 512x435x146 scan at 0.86/0.86/2.5mm:

- **91 s** wall clock
- **10.7 GB** peak GPU
- **~26 GB** peak host RAM

The host RAM is the one to watch. It comes from nnU-Net accumulating a 34-class logit array at
1mm isotropic over the whole field of view, plus a float32 conversion at the end, so it scales
with how much of the body the scan covers. Inference on the site is serialised behind a lock
already, so this will not run concurrently with another model, but it does need that headroom
alongside whatever else is resident.

This is heavier than ePAI. If the box is tight, that is worth knowing before it goes live
rather than after.

## The second checkpoint: AtlasNet-Tumors

Same release, same procedure, different zip. Only needed if you are enabling the Tumors option
as well; Organs works on its own.

| Variable | Default |
|---|---|
| `ATLASNET_TUMORS_MODEL_PATH` | `/home/visitor/atlasnet_tumors/nnUnet_resencM_trained_lesion_3_organs` |
| `CONDA_ENV_ATLASNET_TUMORS` | `atlasnet` (the same env works, nothing extra to install) |

```bash
mkdir -p /home/visitor/atlasnet_tumors && cd /home/visitor/atlasnet_tumors
curl -L -O https://huggingface.co/AbdomenAtlas/AtlasNet/resolve/main/AbdomenAtlasNetTumors.zip
unzip -q AbdomenAtlasNetTumors.zip && rm AbdomenAtlasNetTumors.zip
```

2.3 GB down. Note the trainer directory is named differently here
(`nnUnet_resencM_trained_lesion_3_organs`), and the capitalisation is the release's own.

**Its output looks different, and that is expected.** Tumors is region-based, so it emits a
sparse label set rather than a dense range:

```
1, 2, 3, 6, 7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
```

No 4, 5, 11, 12 or 13. If you run the verification step above against this checkpoint and see
gaps, that is correct. For Organs, gaps would mean something is wrong. Worth keeping straight,
because it is the opposite conclusion from the same observation.

It is also lighter than Organs (ResEnc-M rather than ResEnc-L), so if Organs fits, this will.
Measured on the same A100 and scan: **227 s** and **5.1 GB** peak GPU, against 91 s and 10.7 GB
for Organs. Slower but roughly half the memory; most of the extra time is the export, not the
GPU pass.
