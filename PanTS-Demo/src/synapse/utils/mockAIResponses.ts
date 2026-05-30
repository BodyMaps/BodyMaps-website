import { ANATOMY, type OrganId } from '../data/anatomyData';
import type { AIContext } from './aiContextBuilder';

export const DISCLAIMER =
  'Educational visualization demo only. Not for clinical diagnosis or medical decision-making.';

export type ActionType = 'focus' | 'mode' | 'view' | 'reset' | 'play_slices';

export interface AssistantAction {
  id: string;
  label: string;
  type: ActionType;
  payload: string | null;
}

export interface AssistantResponse {
  text: string;
  actions: AssistantAction[];
}

function action(id: string, label: string, type: ActionType, payload: string | null = null): AssistantAction {
  return { id, label, type, payload };
}

const focusAction = (organId: OrganId): AssistantAction =>
  action(`focus_${organId}`, `Focus on ${ANATOMY[organId].name}`, 'focus', organId);

const modeAction = (modeId: string, label: string): AssistantAction =>
  action(`mode_${modeId}`, label, 'mode', modeId);

function diagnosticRefusal(ctx: AIContext): AssistantResponse {
  return {
    text:
      `I can explain what's displayed on the SYNAPSE CT viewer — anatomy, segmentation confidence, ` +
      `visualization modes, and CT slice navigation — but I can't provide a medical diagnosis. ` +
      `The findings shown on this case (${ctx.study.caseId}) are simulated demo data, not a real patient. ` +
      `For real imaging review, a qualified radiologist must read the actual study.`,
    actions: [],
  };
}

function describeOrgan(organId: OrganId, ctx: AIContext): AssistantResponse {
  const a = ANATOMY[organId];
  const subLine = ctx.selection?.subStructure
    ? `\n\nYou're currently focused on the **${ctx.selection.subStructure.name}**: ${ctx.selection.subStructure.description}`
    : '';
  return {
    text:
      `**${a.name}** — ${a.system}, located in the ${a.location.toLowerCase()}.\n\n` +
      `${a.description}\n\n` +
      `Demo AI finding: "${a.finding}" at ${a.confidence}% confidence.${subLine}`,
    actions: [
      focusAction(a.id),
      modeAction('sections', 'Color-code Sub-structures'),
      modeAction('translucent', 'View Translucent'),
    ],
  };
}

interface KeywordRule {
  match: string[];
  organ: OrganId;
}

const KEYWORDS: KeywordRule[] = [
  { match: ['liver', 'hepat', 'couinaud'], organ: 'liver' },
  { match: ['kidney', 'renal', 'nephr'], organ: 'kidney' },
  { match: ['lung', 'pulmonary', 'bronch', 'respirat'], organ: 'lung' },
  { match: ['pancreas', 'pancreatic', 'islet'], organ: 'pancreas' },
  { match: ['colon', 'large intestine', 'caecum', 'appendix', 'rectum', 'sigmoid'], organ: 'colon' },
];

export function generateMockResponse(userText: string, ctx: AIContext): AssistantResponse {
  const q = (userText || '').toLowerCase().trim();

  // 1. Refuse diagnoses.
  if (/diagnos|prognos|treatment|cancer\?|tumor\?|is this (bad|serious)|am i ok/.test(q)) {
    return diagnosticRefusal(ctx);
  }

  // 2. "What am I looking at?"
  if (
    /what (am i|is this|do i see|i'?m i looking at)|current selection|this structure|right now/.test(q) ||
    /^what'?s (this|that)\??$/.test(q)
  ) {
    if (ctx.selection) {
      const organId = KEYWORDS.find((k) => ctx.selection!.organ.toLowerCase().includes(k.organ))?.organ ?? null;
      const fromName = (Object.keys(ANATOMY) as OrganId[]).find(
        (id) => ANATOMY[id].name === ctx.selection!.organ
      );
      const target = organId || fromName;
      if (target) return describeOrgan(target, ctx);
    }
    return {
      text:
        `Nothing is selected yet. Pick an organ from the focus rail on the left or click directly on the 3D model. ` +
        `Once selected I can describe it, summarize the demo AI finding, and walk you through any sub-structure you click.`,
      actions: [focusAction('liver'), focusAction('lung'), focusAction('pancreas')],
    };
  }

  // 3. Keyword match against organ names.
  for (const k of KEYWORDS) {
    if (k.match.some((m) => q.includes(m))) {
      return describeOrgan(k.organ, ctx);
    }
  }

  // 4. Visualization-mode questions.
  if (/solid mode|opaque/.test(q)) {
    return {
      text:
        'Solid mode renders the organ with full opacity — the default view for inspecting surface morphology.',
      actions: [modeAction('solid', 'Switch to Solid Mode')],
    };
  }
  if (/translucent|see through|see-through/.test(q)) {
    return {
      text:
        'Translucent mode drops opacity so you can see internal sub-structures (lobes, segments, vessels-impressions) through the outer surface. Useful for understanding spatial relationships.',
      actions: [modeAction('translucent', 'Switch to Translucent Mode')],
    };
  }
  if (/x-?ray|emissive/.test(q)) {
    return {
      text:
        'X-Ray mode boosts emissive intensity on a heavily transparent material — gives a glowing volumetric look reminiscent of cinematic medical imaging visualizations.',
      actions: [modeAction('xray', 'Switch to X-Ray Mode')],
    };
  }
  if (/section|lobe|segment|color.?cod|couinaud/.test(q)) {
    return {
      text:
        "Sections mode assigns a different color to each anatomical sub-structure. " +
        "For the liver that means the eight Couinaud segments, the caudate and quadrate lobes, and ligaments. " +
        "For the lungs it color-codes each bronchopulmonary segment.",
      actions: [modeAction('sections', 'Switch to Sections Mode')],
    };
  }
  if (/wireframe|mesh/.test(q)) {
    return {
      text: 'Wireframe mode shows the underlying triangle mesh — handy if you want to see how detailed the segmentation actually is.',
      actions: [modeAction('wireframe', 'Switch to Wireframe Mode')],
    };
  }

  // 5. CT slice questions.
  if (/slice|axial|sagittal|coronal|multiplanar|mpr/.test(q)) {
    return {
      text:
        `The viewer reconstructs ${ctx.study.study} as ${ctx.slices.total} axial slices at ${ctx.study.sliceThickness} thickness. ` +
        `You're currently on axial ${ctx.slices.axial}, sagittal ${ctx.slices.sagittal}, coronal ${ctx.slices.coronal}. ` +
        `Use the sliders on the right or play the bottom timeline to sweep superior → inferior.`,
      actions: [
        modeAction('slices', 'Open CT Slice Mode'),
        action('play_slices', 'Play Scan Sweep', 'play_slices', null),
      ],
    };
  }

  // 6. Confidence / AI segmentation.
  if (/confidence|segmentation|accuracy|ai (work|do|analy)/.test(q)) {
    return {
      text:
        "Segmentation confidence is the model's probability that a given voxel cluster belongs to the labelled structure. " +
        '98% means the network is very sure of its outline; under ~85% you would usually want a human radiologist to verify the boundary. ' +
        'For this demo case overall scores are: Organ 98.4% · Sub-structure 96.5% · Surface 99.1% · Registration 97.8%.',
      actions: [],
    };
  }

  // 7. Region / system questions.
  if (/what.*(abdomen|belly|abdominal)/.test(q)) {
    return {
      text:
        'In this dataset the abdomen contains the liver (right upper quadrant), pancreas (retroperitoneum across L1/L2), and most of the colon. The right kidney sits posteriorly in the retroperitoneum.',
      actions: [focusAction('liver'), focusAction('pancreas'), focusAction('colon'), focusAction('kidney')],
    };
  }
  if (/what.*(chest|thorax|respirat)/.test(q)) {
    return {
      text:
        'In the thorax this dataset shows the lungs with detailed bronchopulmonary segments and the full tracheobronchial cartilage tree.',
      actions: [focusAction('lung')],
    };
  }
  if (/visible human|panTS|pants|dataset/i.test(q)) {
    return {
      text:
        'The 3D models in this viewer are sub-anatomical segmentations from the Visible Human Project, shipped with the PanTS-Demo website. ' +
        '"VH_M" prefixed meshes come from the Visible Human Male, "VH_F" from the Visible Human Female. ' +
        'Each organ is broken down into clinically meaningful sub-structures (e.g. Couinaud liver segments, bronchopulmonary lung segments).',
      actions: [focusAction('liver'), focusAction('lung')],
    };
  }

  // 8. Help.
  if (/help|what can you do|capab|how do/.test(q)) {
    return {
      text:
        'I can help you with:\n' +
        '• Explaining any of the 5 organs and their sub-structures (Couinaud segments, bronchopulmonary segments, etc.)\n' +
        '• Comparing visualization modes (Solid, Translucent, X-Ray, Sections, CT Slices, Wireframe)\n' +
        '• Walking you through the CT slice explorer\n' +
        '• Explaining segmentation confidence and the Visible Human dataset\n\n' +
        'Try: "What are the Couinaud segments?", "Switch to Sections mode", or "What\'s in the abdomen?"',
      actions: [focusAction('liver'), modeAction('sections', 'Try Sections Mode'), action('reset', 'Reset View', 'reset', null)],
    };
  }

  // 9. Greeting.
  if (/^(hi|hello|hey|yo|sup)\b/.test(q)) {
    return {
      text:
        `Hi — SYNAPSE AI here. Case ${ctx.study.caseId} is loaded from the ${ctx.study.source} and AI segmentation is complete. ` +
        `Pick an organ on the focus rail or ask me about any of the 5 anatomical structures, CT slices, or visualization modes.`,
      actions: [focusAction('liver'), focusAction('lung'), modeAction('slices', 'Open CT Slices')],
    };
  }

  // 10. Default fallback.
  const selLine = ctx.selection
    ? `You currently have **${ctx.selection.organ}** selected${
        ctx.selection.subStructure ? ` (focused on ${ctx.selection.subStructure.name})` : ''
      }.`
    : 'Nothing is selected right now.';
  return {
    text:
      `I'm not sure I caught that, but I can answer questions about the 5 organs (liver, kidney, lung, pancreas, colon), ` +
      `visualization modes, CT slice navigation, or segmentation confidence. ${selLine}`,
    actions: ctx.selection
      ? [
          modeAction('sections', 'Color-code Sub-structures'),
          modeAction('slices', 'Open CT Slices'),
        ]
      : [focusAction('liver'), focusAction('lung'), focusAction('pancreas')],
  };
}
