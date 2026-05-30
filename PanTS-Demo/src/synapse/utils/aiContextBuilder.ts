import { ANATOMY, type OrganId, type SubStructure } from '../data/anatomyData';
import { SCAN_SUMMARY } from '../data/scanData';
import type { VisMode } from '../data/scanData';

export interface ViewerState {
  selectedOrgan: OrganId | null;
  selectedSubKey: string | null;
  selectedSubData: SubStructure | null;
  mode: VisMode;
  slices: { axial: number; sagittal: number; coronal: number };
  autoRotate: boolean;
}

export interface AIContext {
  selection: {
    organ: string;
    system: string;
    location: string;
    finding: string;
    confidence: number;
    description: string;
    subStructure?: { name: string; description: string };
  } | null;
  visualizationMode: VisMode;
  slices: { axial: number; sagittal: number; coronal: number; total: number };
  autoRotate: boolean;
  study: {
    caseId: string;
    study: string;
    source: string;
    sliceThickness: string;
    contrast: string;
    scanQuality: number;
  };
  disclaimer: string;
}

export function buildAIContext(state: ViewerState): AIContext {
  const organ = state.selectedOrgan ? ANATOMY[state.selectedOrgan] : null;

  return {
    selection: organ
      ? {
          organ: organ.name,
          system: organ.system,
          location: organ.location,
          finding: organ.finding,
          confidence: organ.confidence,
          description: organ.description,
          subStructure: state.selectedSubData
            ? {
                name: state.selectedSubData.displayName,
                description: state.selectedSubData.description,
              }
            : undefined,
        }
      : null,
    visualizationMode: state.mode,
    slices: {
      axial: state.slices.axial,
      sagittal: state.slices.sagittal,
      coronal: state.slices.coronal,
      total: SCAN_SUMMARY.images,
    },
    autoRotate: state.autoRotate,
    study: {
      caseId: SCAN_SUMMARY.caseId,
      study: SCAN_SUMMARY.study,
      source: SCAN_SUMMARY.source,
      sliceThickness: SCAN_SUMMARY.sliceThickness,
      contrast: SCAN_SUMMARY.contrast,
      scanQuality: SCAN_SUMMARY.scanQuality,
    },
    disclaimer:
      'Educational visualization demo only. Not for clinical diagnosis or medical decision-making.',
  };
}

export function renderContextAsPrompt(ctx: AIContext): string {
  const sel = ctx.selection
    ? `Selected organ: ${ctx.selection.organ} (${ctx.selection.system}, ${ctx.selection.location}). ` +
      (ctx.selection.subStructure
        ? `Specifically focused on the ${ctx.selection.subStructure.name}. `
        : '') +
      `Demo AI finding: "${ctx.selection.finding}" at ${ctx.selection.confidence}% segmentation confidence.`
    : 'No anatomical structure is currently selected.';

  return [
    'You are SYNAPSE AI, the imaging assistant inside the SYNAPSE CT volumetric explorer integrated into the PanTS-Demo / BodyMaps website.',
    'The 3D models on display are Visible Human Project anatomical segmentations.',
    'You explain anatomy, visualization modes, CT slice navigation, and AI segmentation concepts.',
    'You NEVER provide a real medical diagnosis. All findings are simulated demo data.',
    '',
    `Case: ${ctx.study.caseId}. Study: ${ctx.study.study}. Source: ${ctx.study.source}.`,
    sel,
    `Current visualization mode: ${ctx.visualizationMode}.`,
    `Current slice indices — axial: ${ctx.slices.axial}/${ctx.slices.total}, sagittal: ${ctx.slices.sagittal}/${ctx.slices.total}, coronal: ${ctx.slices.coronal}/${ctx.slices.total}.`,
    '',
    'Always end with the disclaimer: "Educational visualization demo only. Not for clinical diagnosis."',
  ].join('\n');
}
