import { VIEW_PRESETS } from '../data/scanData';

interface Props {
  onView: (id: string) => void;
}

export default function ViewPresetControls({ onView }: Props) {
  return (
    <div className="syn-view-presets">
      {VIEW_PRESETS.map((v) => (
        <button key={v.id} onClick={() => onView(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}
