# User MRI collection

The MRI sibling of the CT collection (`UserData`, `services/user_dataset.py`). When a user sends a scan to the server
for segmentation, the MRI gate (`services/user_mri_dataset.py`) works out whether it is an MRI and, if it passes, keeps
a copy for research. **Scans that stay in the browser (the local viewer) are never sent, so are never collected.**

It is off until `USER_MRI_DATASET_PATH` is set. Collection runs on a background thread after the job is accepted and
never affects the user's request or the segmentation job.

## Where it lives

A folder next to the CT collection, in the same layout:

```
/home/visitor/UserData/         the CT collection (unchanged)
/home/visitor/UserDataMRI/      this one
  image_only/USER_MRI_00000001/mri.nii.gz
  image_only/USER_MRI_00000001/metadata.json
  registry.json                 id counter, fingerprints, rolling quota events
  rejections.jsonl              what was turned away and why
```

There is no `mask_only`: nothing is segmented and nothing in the folder is human-verified.

## What it keeps

1. **It must be an MRI.** A 3D volume with no CT signature (no air band near -1000, no negative HU range). A CT, or
   anything that cannot be told apart, is ignored without a trace: this runs on every upload, so it does not log, count
   or reject the CTs. 4D series (time or diffusion) are not collected.
2. **It must be usable.** Not empty (foreground at least 3%), not noise (neighbouring voxels must agree), not too noisy
   (estimated SNR at least 3), not saturated, plausible size, and not clearly coarse (slices up to 8 mm, in-plane up to
   2.5 mm).
3. **Not a duplicate**: an exact repeat (file hash) or a near repeat (a coarse, intensity-scale-free content hash).
4. **Not abuse**: the CT collection's daily caps per user, per address and globally, a 2 GB size cap, and a free-disk
   floor (default 100 GB).

## Quality tier

Every kept case carries `quality_tier` in its `metadata.json`: **high** needs slices of at most 3 mm, in-plane at most
1.2 mm, an estimated SNR of at least 10 (a background with no noise at all, as in a skull-stripped scan, is not
penalised), foreground of at least 8% and saturation of at most 2%. Otherwise **standard**, and `tier_blockers` lists
why. The pulse sequence (T1, T2, FLAIR) is not recorded: a NIfTI file does not say reliably.

All limits can be changed with `USER_MRI_DATASET_*` environment variables (see the top of the module).

## Turning it on

```bash
mkdir -p /home/visitor/UserDataMRI
# flask-server/.env:  USER_MRI_DATASET_PATH=/home/visitor/UserDataMRI
bash flask-server/deploy/start_backend.sh     # restart at 0 running jobs
```

## Counting what it holds

```bash
ls /home/visitor/UserDataMRI/image_only | grep -c '^USER_MRI_'
grep -h -o '"quality_tier": "[a-z]*"' /home/visitor/UserDataMRI/image_only/*/metadata.json | sort | uniq -c
cut -c1-120 /home/visitor/UserDataMRI/rejections.jsonl | tail      # why scans were turned away
```
