import { useState, useEffect, useMemo, useCallback } from 'react';
import Header from '../components/Header';

import LeftDashboard from '../synapse/components/LeftDashboard';
import AnatomyViewer from '../synapse/components/AnatomyViewer';
import ViewPresetControls from '../synapse/components/ViewPresetControls';
import ViewerControls from '../synapse/components/ViewerControls';
import VisualizationModePanel from '../synapse/components/VisualizationModePanel';
import MultiplanarPreview from '../synapse/components/MultiplanarPreview';
import SelectedAnatomyCard from '../synapse/components/SelectedAnatomyCard';
import AIAnalysisPanel from '../synapse/components/AIAnalysisPanel';
import AIAssistant from '../synapse/components/AIAssistant';
import CTSliceExplorer from '../synapse/components/CTSliceExplorer';
import BottomTimeline from '../synapse/components/BottomTimeline';
import ModelFallback from '../synapse/components/ModelFallback';

import { useAnatomySelection } from '../synapse/hooks/useAnatomySelection';
import { useChatAssistant } from '../synapse/hooks/useChatAssistant';
import { ANATOMY, type OrganId } from '../synapse/data/anatomyData';
import { TABS, type Tab, type VisMode } from '../synapse/data/scanData';
import type { ViewerState } from '../synapse/utils/aiContextBuilder';
import { getAIMode } from '../synapse/services/aiService';
import type { AssistantAction } from '../synapse/utils/mockAIResponses';

import '../synapse/synapse.css';

export default function SynapsePage() {
  const sel = useAnatomySelection();
  const {
    viewerRef,
    selectedOrgan,
    selectedSubData,
    mode,
    setMode,
    autoRotate,
    toggleAutoRotate,
    slices,
    setSlices,
    setSlice,
    slicePlay,
    setSlicePlay,
    showPlanes,
    setShowPlanes,
    selectOrgan,
    selectMesh,
    setView,
    resetView,
  } = sel;

  const [activeTab, setActiveTab] = useState<Tab>('3D Volume');
  const [usingFallback, setUsingFallback] = useState(false);
  const [glbLoaded, setGlbLoaded] = useState(false);
  const aiMode = useMemo(() => getAIMode(), []);

  // Reset the load state when the organ changes; AnatomyViewer's HEAD check
  // will set glbLoaded back to true once it resolves.
  useEffect(() => {
    setGlbLoaded(false);
    setUsingFallback(false);
    const t = setTimeout(() => setGlbLoaded(true), 600);
    return () => clearTimeout(t);
  }, [selectedOrgan]);

  // Build the AI context (a snapshot of viewer state) on demand.
  const getViewerState = useCallback<() => ViewerState>(
    () => ({
      selectedOrgan,
      selectedSubKey: sel.selectedSubKey,
      selectedSubData,
      mode,
      slices,
      autoRotate,
    }),
    [selectedOrgan, sel.selectedSubKey, selectedSubData, mode, slices, autoRotate]
  );
  const chat = useChatAssistant(getViewerState);

  // Dispatch an assistant action button (focus an organ, switch mode, etc.).
  const onAction = useCallback(
    (a: AssistantAction) => {
      if (a.type === 'focus' && a.payload && a.payload in ANATOMY) {
        selectOrgan(a.payload as OrganId);
      } else if (a.type === 'mode' && a.payload) {
        setMode(a.payload as VisMode);
      } else if (a.type === 'view' && a.payload) {
        setView(a.payload);
      } else if (a.type === 'reset') {
        resetView();
      } else if (a.type === 'play_slices') {
        setMode('slices');
        setShowPlanes(true);
        setSlicePlay(true);
      }
    },
    [selectOrgan, setMode, setView, resetView, setShowPlanes, setSlicePlay]
  );

  const onStartScan = useCallback(() => {
    setMode('slices');
    setShowPlanes(true);
    setSlicePlay(true);
  }, [setMode, setShowPlanes, setSlicePlay]);

  const onTopView = useCallback(() => setView('top'), [setView]);

  const onPickMesh = useCallback(
    (
      meshName: string,
      organId: OrganId,
      sub: Parameters<typeof selectMesh>[2]
    ) => selectMesh(meshName, organId, sub),
    [selectMesh]
  );

  return (
    <div className="synapse-ct-page">
      <Header handleAboutClick={() => {}} />
      <div className="syn-grid" />
      <div className="syn-vignette" />

      <div className="syn-shell">
        <div className="syn-subbar">
          <div className="syn-eyebrow-bar">
            <div className="syn-mark">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#54d6ff" strokeWidth="1.4" />
                <circle cx="12" cy="12" r="3" fill="#f0b860" />
              </svg>
            </div>
            <div>
              <div className="name">SYNAPSE CT</div>
              <div className="sub">VOLUMETRIC ANATOMY EXPLORER</div>
            </div>
          </div>

          <nav className="syn-tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={t === activeTab ? 'active' : ''}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="syn-hstatus">
            <div className="syn-pill">
              <span className="syn-dot" />
              AI Online
            </div>
            <div className="syn-case-chip">CASE A-0248</div>
          </div>
        </div>

        <div className="syn-stage">
          <LeftDashboard
            autoRotate={autoRotate}
            activeOrgan={selectedOrgan}
            onStartScan={onStartScan}
            onToggleAuto={toggleAutoRotate}
            onReset={resetView}
            onSelectOrgan={selectOrgan}
          />

          <div className="syn-center">
            <ViewPresetControls onView={setView} />
            <AnatomyViewer
              ref={viewerRef}
              organId={selectedOrgan ?? 'liver'}
              mode={mode}
              slices={slices}
              slicePlay={slicePlay}
              showPlanes={showPlanes}
              autoRotate={autoRotate}
              onPickMesh={onPickMesh}
              onSlicePlayTick={(idx: number) => setSlice('axial', idx)}
              onFallbackChange={setUsingFallback}
            />
            <ViewerControls
              activeOrgan={selectedOrgan}
              autoRotate={autoRotate}
              onSelectOrgan={selectOrgan}
              onToggleAuto={toggleAutoRotate}
              onReset={resetView}
              onTopView={onTopView}
            />
            <ModelFallback
              state={!glbLoaded ? 'loading' : usingFallback ? 'fallback' : 'hidden'}
              organId={selectedOrgan}
            />
          </div>

          <div className="syn-col">
            <VisualizationModePanel mode={mode} onMode={setMode} />
            <MultiplanarPreview slices={slices} />
            <SelectedAnatomyCard organId={selectedOrgan} subData={selectedSubData} />
            <AIAnalysisPanel />
            <AIAssistant
              messages={chat.messages}
              isTyping={chat.isTyping}
              onSend={chat.send}
              onClear={chat.clear}
              organId={selectedOrgan}
              onAction={onAction}
              aiMode={aiMode}
            />
            <CTSliceExplorer
              slices={slices}
              onSlice={setSlice}
              showPlanes={showPlanes}
              onTogglePlanes={() => setShowPlanes(!showPlanes)}
            />
          </div>
        </div>

        <BottomTimeline
          slices={slices}
          setSlices={setSlices}
          play={slicePlay}
          setPlay={setSlicePlay}
        />
      </div>
    </div>
  );
}
