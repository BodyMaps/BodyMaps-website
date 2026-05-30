export const SCAN_SUMMARY = {
  caseId: 'A-0248',
  study: 'Visible Human Volumetric Segmentation',
  source: 'PanTS-Demo / Visible Human Project',
  sliceThickness: '0.8 mm',
  images: 512,
  scanQuality: 98,
  contrast: 'IV',
  status: 'Analyzed',
};

export const TABS = ['Overview', '3D Volume', 'Slice Explorer', 'Findings', 'AI Assistant'] as const;
export type Tab = (typeof TABS)[number];

export interface ViewPreset {
  id: string;
  label: string;
  cam: [number, number, number];
  target: [number, number, number];
}

export const VIEW_PRESETS: ViewPreset[] = [
  { id: 'front', label: 'Front', cam: [0, 0.4, 5], target: [0, 0, 0] },
  { id: 'back', label: 'Back', cam: [0, 0.4, -5], target: [0, 0, 0] },
  { id: 'left', label: 'Left Side', cam: [-5, 0.4, 0], target: [0, 0, 0] },
  { id: 'right', label: 'Right Side', cam: [5, 0.4, 0], target: [0, 0, 0] },
  { id: 'top', label: 'Top', cam: [0, 5, 0.4], target: [0, 0, 0] },
  { id: 'oblique', label: 'Oblique', cam: [3.2, 1.6, 4.0], target: [0, 0, 0] },
];

// Visualization modes revised for organ-centric content.
export type VisMode = 'solid' | 'translucent' | 'xray' | 'sections' | 'slices' | 'wireframe';

export interface VisModeInfo {
  id: VisMode;
  label: string;
  color: string;
  hint: string;
}

export const VIS_MODES: VisModeInfo[] = [
  { id: 'solid', label: 'Solid', color: '#54d6ff', hint: 'Standard opaque rendering' },
  { id: 'translucent', label: 'Translucent', color: '#9fb6d4', hint: 'See internal structures' },
  { id: 'xray', label: 'X-Ray', color: '#7fe3ff', hint: 'High-emissive transparent view' },
  { id: 'sections', label: 'Sections', color: '#f0b860', hint: 'Color-code anatomical sub-structures' },
  { id: 'slices', label: 'CT Slices', color: '#54d6ff', hint: 'Overlay axial / sagittal / coronal planes' },
  { id: 'wireframe', label: 'Wireframe', color: '#5fe3a1', hint: 'Mesh topology view' },
];

export interface AnalysisStat {
  id: string;
  label: string;
  value: number;
}

export const ANALYSIS_STATS: AnalysisStat[] = [
  { id: 'organ', label: 'Organ Segmentation', value: 98.4 },
  { id: 'sub', label: 'Sub-structure Identification', value: 96.5 },
  { id: 'surface', label: 'Surface Reconstruction', value: 99.1 },
  { id: 'registration', label: 'Scan Registration', value: 97.8 },
];

export const TIMELINE_LABELS = ['Superior', 'Thorax', 'Abdomen', 'Pelvis', 'Inferior'];

export const DEFAULT_CAMERA = {
  cam: [3.2, 1.4, 4.2] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
};
