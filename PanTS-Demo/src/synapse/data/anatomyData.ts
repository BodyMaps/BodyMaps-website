// Anatomy reference data, rebuilt around the real Visible Human Project
// segmentations shipped in PanTS-Demo/public/.
//
// Top-level organs (drives which GLB is loaded and the focus rail buttons):
//   liver, kidney, lung, pancreas, colon
//
// Sub-structures (drives click-detail in the Selected Anatomy card and in
// the AI assistant). Keys are substring matches against the GLB mesh names.

export type OrganId = 'liver' | 'kidney' | 'lung' | 'pancreas' | 'colon';

export interface SubStructure {
  displayName: string;
  description: string;
}

export interface Organ {
  id: OrganId;
  name: string;
  system: string;
  location: string;
  description: string;
  finding: string;
  confidence: number;
  glbPath: string;
  // camera target for fly-to. Each organ GLB centers near origin; values are
  // gentle overhead-front views; tweak if a particular model looks off.
  focus: { cam: [number, number, number]; target: [number, number, number] };
  // substring matchers against mesh names (case-insensitive) used to verify
  // a mesh belongs to this organ.
  meshAliases: string[];
  // sub-mesh detail. Substring match against the clicked mesh name.
  subStructures: Record<string, SubStructure>;
}

export const ANATOMY: Record<OrganId, Organ> = {
  liver: {
    id: 'liver',
    name: 'Liver',
    system: 'Hepatobiliary',
    location: 'Right upper quadrant',
    description:
      'Hepatic parenchyma with eight Couinaud segments, ligamentous attachments, and impressions from adjacent organs. Reconstructed from Visible Human segmentation.',
    finding: 'Homogeneous parenchyma, no lesions',
    confidence: 97.1,
    glbPath: '/3d-liver.glb',
    focus: { cam: [3.2, 1.4, 4.0], target: [0, 0, 0] },
    meshAliases: ['liver', 'hepat'],
    subStructures: {
      right_lobe: {
        displayName: 'Right Lobe of Liver',
        description:
          "The larger of the two main lobes, separated from the left by the falciform ligament. Contains Couinaud segments V–VIII.",
      },
      left_lobe: {
        displayName: 'Left Lobe of Liver',
        description:
          'Smaller lobe extending across the midline to the left. Contains segments II–IV.',
      },
      caudate: {
        displayName: 'Caudate Lobe',
        description:
          'Couinaud segment I. Sits posteriorly between the inferior vena cava and the ligamentum venosum, with independent venous drainage.',
      },
      quadrate: {
        displayName: 'Quadrate Lobe',
        description:
          'Part of Couinaud segment IVb on the inferior surface, bordered by the gallbladder fossa and round ligament.',
      },
      anterosuperior: {
        displayName: 'Right Anterosuperior Segment (VIII)',
        description: 'Couinaud segment VIII — superior portion of the right anterior sector.',
      },
      anteroinferior: {
        displayName: 'Right Anteroinferior Segment (V)',
        description: 'Couinaud segment V — inferior portion of the right anterior sector.',
      },
      posterosuperior: {
        displayName: 'Right Posterosuperior Segment (VII)',
        description: 'Couinaud segment VII — superior portion of the right posterior sector.',
      },
      posteroinferior: {
        displayName: 'Right Posteroinferior Segment (VI)',
        description: 'Couinaud segment VI — inferior portion of the right posterior sector.',
      },
      falciform: {
        displayName: 'Falciform Ligament',
        description:
          'Sickle-shaped peritoneal fold connecting the anterior surface of the liver to the diaphragm and anterior abdominal wall.',
      },
      round_ligament: {
        displayName: 'Round Ligament of Liver',
        description: 'Remnant of the obliterated umbilical vein, running in the free edge of the falciform ligament.',
      },
      coronary: {
        displayName: 'Coronary Ligament',
        description: 'Peritoneal reflection from the diaphragm onto the liver, bounding the bare area.',
      },
      triangular: {
        displayName: 'Triangular Ligament',
        description: 'Lateral extensions of the coronary ligament fixing the liver to the diaphragm.',
      },
      bare_area: {
        displayName: 'Bare Area of Liver',
        description:
          'Posterosuperior surface in direct contact with the diaphragm, not covered by peritoneum.',
      },
      porta_hepatis: {
        displayName: 'Porta Hepatis',
        description:
          'Transverse fissure on the inferior surface; entry/exit point for the portal vein, hepatic artery, and bile ducts.',
      },
    },
  },

  kidney: {
    id: 'kidney',
    name: 'Right Kidney',
    system: 'Urinary',
    location: 'Retroperitoneum, right',
    description:
      "Right renal cortex, medulla, pyramids and hilum reconstructed at sub-millimeter resolution. Visible Human female segmentation.",
    finding: 'Symmetric perfusion, no calculi',
    confidence: 95.8,
    glbPath: '/3d-kidney.glb',
    focus: { cam: [2.4, 1.0, 3.0], target: [0, 0, 0] },
    meshAliases: ['kidney', 'renal', 'nephr', 'hilum_of_kidney'],
    subStructures: {
      capsule: {
        displayName: 'Renal Capsule',
        description: 'Tough fibrous outer covering protecting the renal parenchyma.',
      },
      cortex: {
        displayName: 'Renal Cortex',
        description:
          'Outer layer containing glomeruli and convoluted tubules; the primary site of filtration.',
      },
      column: {
        displayName: 'Renal Column',
        description:
          'Cortical tissue extending between renal pyramids; carries interlobar vessels.',
      },
      pyramid: {
        displayName: 'Renal Pyramid',
        description:
          'Cone-shaped medullary structure containing the loops of Henle and collecting ducts. The kidney typically has 8–18 pyramids.',
      },
      hilum: {
        displayName: 'Renal Hilum',
        description:
          'Medial concave fissure where the renal artery enters and the renal vein, ureter, and lymphatics exit.',
      },
    },
  },

  lung: {
    id: 'lung',
    name: 'Lungs',
    system: 'Respiratory',
    location: 'Thoracic cavity',
    description:
      'Bilateral lungs with detailed bronchopulmonary segments and the complete tracheobronchial cartilage tree. Visible Human female segmentation.',
    finding: 'Clear lung fields, no nodules detected',
    confidence: 96.2,
    glbPath: '/3d-lung.glb',
    focus: { cam: [3.0, 1.6, 4.2], target: [0, 0, 0] },
    meshAliases: ['lung', 'bronch', 'pulmon', 'hilum', 'cartilage_of', 'lobar'],
    subStructures: {
      upper_lobe: {
        displayName: 'Upper Lobe',
        description:
          'Superior lobe of the lung. Three lobes on the right (upper/middle/lower) and two on the left (upper/lower).',
      },
      middle_lobe: {
        displayName: 'Right Middle Lobe',
        description:
          'Wedge-shaped lobe present only on the right side, between the upper and lower lobes.',
      },
      lower_lobe: {
        displayName: 'Lower Lobe',
        description: 'Inferior lobe of the lung, separated from the upper by the oblique fissure.',
      },
      apical: {
        displayName: 'Apical Bronchopulmonary Segment',
        description: 'Most superior segment within the upper lobe.',
      },
      anterior: {
        displayName: 'Anterior Bronchopulmonary Segment',
        description: 'Anterior segment of the upper lobe.',
      },
      posterior: {
        displayName: 'Posterior Bronchopulmonary Segment',
        description: 'Posterior segment of the upper lobe.',
      },
      lingula_superior: {
        displayName: 'Superior Lingular Segment',
        description: "Tongue-shaped projection from the left upper lobe; left-side analogue of the right middle lobe.",
      },
      lingula_inferior: {
        displayName: 'Inferior Lingular Segment',
        description: 'Inferior portion of the left lingula.',
      },
      superior_basal: {
        displayName: 'Superior Basal Segment',
        description: 'Most superior segment of the lower lobe.',
      },
      basal: {
        displayName: 'Basal Bronchopulmonary Segment',
        description: 'Inferior segments of the lower lobe (medial, anterior, lateral, posterior basal).',
      },
      hilum: {
        displayName: 'Pulmonary Hilum',
        description:
          'Root of the lung — entry point for the main bronchus, pulmonary artery, pulmonary veins, and lymphatics.',
      },
      cartilage_of_lobar_bronchus: {
        displayName: 'Cartilage of Lobar Bronchus',
        description:
          'Plates of hyaline cartilage reinforcing the lobar (secondary) bronchi, keeping the airway patent during respiration.',
      },
      cartilage_of_tertiary_bronchus: {
        displayName: 'Cartilage of Tertiary Bronchus',
        description:
          'Smaller cartilaginous plates supporting the tertiary (segmental) bronchi.',
      },
      lobar_bronchus: {
        displayName: 'Lobar Bronchus',
        description: 'Secondary bronchi branching from the main bronchus to each lobe.',
      },
      tertiary_bronchus: {
        displayName: 'Tertiary (Segmental) Bronchus',
        description: 'Third-generation airways supplying individual bronchopulmonary segments.',
      },
    },
  },

  pancreas: {
    id: 'pancreas',
    name: 'Pancreas',
    system: 'Digestive / Endocrine',
    location: 'Retroperitoneum, epigastrium',
    description:
      'Pancreatic head, neck, body, tail, and uncinate process reconstructed from Visible Human segmentation. The pancreas is part of both the digestive system (exocrine acini producing enzymes) and the endocrine system (Islets of Langerhans producing insulin and glucagon).',
    finding: 'Uniform parenchyma, no mass identified',
    confidence: 94.3,
    glbPath: '/3d-pancreas.glb',
    focus: { cam: [2.4, 1.2, 3.0], target: [0, 0, 0] },
    meshAliases: ['pancreas', 'ucinate'],
    subStructures: {
      head: {
        displayName: 'Head of Pancreas',
        description:
          'Widest portion, sitting within the C-shaped curve of the duodenum. Closely related to the common bile duct.',
      },
      neck: {
        displayName: 'Neck of Pancreas',
        description: 'Short constricted section connecting the head to the body, anterior to the superior mesenteric vessels.',
      },
      body: {
        displayName: 'Body of Pancreas',
        description: 'Central portion lying transversely across the L1/L2 vertebrae, posterior to the stomach.',
      },
      tail: {
        displayName: 'Tail of Pancreas',
        description: 'Narrow left end extending toward the splenic hilum within the splenorenal ligament.',
      },
      ucinate: {
        displayName: 'Uncinate Process',
        description:
          "Hook-shaped extension of the pancreatic head projecting posteriorly behind the superior mesenteric vessels.",
      },
    },
  },

  colon: {
    id: 'colon',
    name: 'Colon',
    system: 'Digestive',
    location: 'Abdominal cavity',
    description:
      'Large intestine reconstructed from Visible Human male segmentation. Includes the caecum and vermiform appendix, ascending, transverse, descending and sigmoid colon, hepatic and splenic flexures, and rectum.',
    finding: 'Normal caliber, no wall thickening',
    confidence: 96.8,
    glbPath: '/3d-colon.glb',
    focus: { cam: [3.2, 1.4, 4.0], target: [0, 0, 0] },
    meshAliases: ['colon', 'caecum', 'rectum', 'appendix', 'flexure', 'ileocecal'],
    subStructures: {
      caecum: {
        displayName: 'Caecum',
        description:
          'Blind-ended pouch at the beginning of the large intestine, in the right iliac fossa. Receives ileal contents via the ileocecal valve.',
      },
      vermiform_appendix: {
        displayName: 'Vermiform Appendix',
        description:
          'Narrow finger-like projection from the caecum; rich in lymphoid tissue. The site of appendicitis.',
      },
      ileocecal_valve: {
        displayName: 'Ileocecal Valve',
        description: 'Sphincter separating the small and large intestines, regulating ileal flow into the caecum.',
      },
      ascending_colon: {
        displayName: 'Ascending Colon',
        description: "Travels superiorly along the right side of the abdomen from caecum to hepatic flexure.",
      },
      hepatic_flexure: {
        displayName: 'Hepatic (Right Colic) Flexure',
        description: 'Right-sided bend of the colon beneath the liver, where ascending meets transverse colon.',
      },
      transverse_colon: {
        displayName: 'Transverse Colon',
        description: 'Crosses the abdomen from right to left between the two colic flexures; the most mobile colonic segment.',
      },
      splenic_flexure: {
        displayName: 'Splenic (Left Colic) Flexure',
        description: 'Sharper left-sided bend near the spleen, where transverse meets descending colon.',
      },
      descending_colon: {
        displayName: 'Descending Colon',
        description: 'Travels inferiorly along the left side of the abdomen from splenic flexure to sigmoid.',
      },
      sigmoid_colon: {
        displayName: 'Sigmoid Colon',
        description: 'S-shaped loop in the left iliac fossa connecting descending colon to rectum.',
      },
      rectum: {
        displayName: 'Rectum',
        description: 'Terminal straight segment of the large intestine, ending at the anal canal.',
      },
    },
  },
};

// Ordered list for the focus rail / model selector.
export const ORGAN_ORDER: OrganId[] = ['liver', 'kidney', 'lung', 'pancreas', 'colon'];

// Returns the OrganId whose meshAliases match the given mesh name, or null.
export function organForMeshName(meshName: string): OrganId | null {
  const n = (meshName || '').toLowerCase();
  for (const id of ORGAN_ORDER) {
    if (ANATOMY[id].meshAliases.some((a) => n.includes(a.toLowerCase()))) return id;
  }
  return null;
}

// Returns the sub-structure key whose substring matches the mesh name, or null.
export function subStructureForMeshName(
  organId: OrganId,
  meshName: string
): { key: string; data: SubStructure } | null {
  const n = (meshName || '').toLowerCase();
  const subs = ANATOMY[organId].subStructures;
  // Prefer the longest matching key — "lingula_superior" should win over "superior".
  const keys = Object.keys(subs).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(k.toLowerCase())) return { key: k, data: subs[k] };
  }
  return null;
}
