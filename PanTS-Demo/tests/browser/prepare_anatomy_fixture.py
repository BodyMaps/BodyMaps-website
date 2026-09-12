"""Create a local CT + GLB browser fixture from a user's aligned NIfTI files.

Dependencies: nibabel, numpy, scikit-image, trimesh. No scans are downloaded.
"""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from skimage.measure import marching_cubes

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('ct', type=Path)
parser.add_argument('mask', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--case', default='fixture')
parser.add_argument('--label-value', type=int, default=1)
parser.add_argument('--stride', type=int, default=2)
args = parser.parse_args()
if args.stride < 1:
    parser.error('--stride must be positive')
ct, seg = nib.load(args.ct), nib.load(args.mask)
if ct.shape != seg.shape or not np.allclose(ct.affine, seg.affine):
    raise ValueError('CT and mask must have matching physical grids')
ct = ct.slicer[::args.stride, ::args.stride, ::args.stride]
seg = seg.slicer[::args.stride, ::args.stride, ::args.stride]
mask = np.asarray(seg.dataobj) == args.label_value
if not mask.any():
    raise ValueError('The selected label is empty after subsampling')
out = args.output / args.case
out.mkdir(parents=True, exist_ok=True)
nib.save(ct, out / 'ct.nii.gz')
vertices, faces, _, _ = marching_cubes(np.pad(mask, 1).astype(np.float32), .5)
ras = nib.affines.apply_affine(seg.affine, vertices - 1)
three = ras[:, [0, 2, 1]].copy()
three[:, 2] *= -1
center = three.mean(0)
three -= center
trimesh.Trimesh(vertices=three, faces=faces, process=False).export(out / 'organ.glb')
manifest = {
    'caseId': args.case, 'center': center.tolist(),
    'bounds': {'min': three.min(0).tolist(), 'max': three.max(0).tolist()},
    'organs': [{'id': 25, 'key': 'fixture_organ', 'name': 'Fixture organ',
                'url': f'http://127.0.0.1:5001/{args.case}/organ.glb',
                'color': '#b687d2', 'vertices': len(vertices), 'faces': len(faces)}],
}
(out / 'manifest.json').write_text(json.dumps(manifest))
print(out)
