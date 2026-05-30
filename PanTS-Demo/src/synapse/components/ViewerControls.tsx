import {
  IconRotateClockwise,
  IconRefresh,
  IconArrowUp,
} from '@tabler/icons-react';
import { ANATOMY, ORGAN_ORDER, type OrganId } from '../data/anatomyData';

interface Props {
  activeOrgan: OrganId | null;
  autoRotate: boolean;
  onSelectOrgan: (id: OrganId) => void;
  onToggleAuto: () => void;
  onReset: () => void;
  onTopView: () => void;
}

export default function ViewerControls({
  activeOrgan,
  autoRotate,
  onSelectOrgan,
  onToggleAuto,
  onReset,
  onTopView,
}: Props) {
  return (
    <>
      <div className="syn-focus-rail">
        {ORGAN_ORDER.map((id) => (
          <button
            key={id}
            className={activeOrgan === id ? 'active' : ''}
            onClick={() => onSelectOrgan(id)}
          >
            <span className="ico" />
            {ANATOMY[id].name}
          </button>
        ))}
      </div>

      <div className="syn-cam-tools">
        <button
          className={autoRotate ? 'on' : ''}
          title="Auto rotate"
          onClick={onToggleAuto}
        >
          <IconRotateClockwise />
        </button>
        <button title="Reset view" onClick={onReset}>
          <IconRefresh />
        </button>
        <button title="Top view" onClick={onTopView}>
          <IconArrowUp />
        </button>
      </div>

      <div className="syn-instr">
        Drag to rotate • Scroll to zoom • Right drag to pan •{' '}
        <b>Click a sub-structure to inspect</b>
      </div>
    </>
  );
}
