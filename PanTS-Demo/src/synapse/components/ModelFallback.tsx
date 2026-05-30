import { ANATOMY, type OrganId } from '../data/anatomyData';

interface Props {
  state: 'loading' | 'fallback' | 'hidden';
  organId: OrganId | null;
}

export default function ModelFallback({ state, organId }: Props) {
  if (state === 'hidden') return null;

  const organName = organId ? ANATOMY[organId].name : 'organ';
  const path = organId ? ANATOMY[organId].glbPath : '';

  return (
    <div className="syn-loader">
      <div className="ring" />
      {state === 'loading' ? (
        <>
          <div className="t">Loading {organName} segmentation…</div>
          <div className="s">
            Streaming <code>{path}</code> from the PanTS-Demo assets.
          </div>
        </>
      ) : (
        <>
          <div className="t">GLB asset not found</div>
          <div className="s">
            Expected <code>{path}</code> in <code>public/</code>. Showing a procedural
            placeholder. Make sure your PanTS-Demo <code>public/</code> folder contains
            the five Visible Human organ GLBs.
          </div>
        </>
      )}
    </div>
  );
}
