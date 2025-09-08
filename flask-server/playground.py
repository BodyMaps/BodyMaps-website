import numpy as np
import nibabel as nib
import os

folder = r"D:\source\repos\jhu\kin\PanTS\data\LabelTr\PanTS_00000001\combined_labels.nii.gz"
# go through folder
# for file in os.listdir(folder):
file = "liver.npz"
path = os.path.join(folder, "liver.npz")
# for i in range(1, 27):
dat = nib.load(folder).get_fdata()
# if np.count_nonzero(dat==1) > 0:
print(np.unique(dat))
print(np.count_nonzero(dat), np.count_nonzero(dat==5))
    # print(f"{file.split('.')[0]}: {1}, ")
        # break