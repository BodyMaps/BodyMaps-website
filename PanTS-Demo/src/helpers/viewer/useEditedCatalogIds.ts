import { useCallback, useEffect, useRef, useState } from "react";
import { getEditedSegments, subscribeToSegmentationEdits } from "../CornerstoneNifti2";

// How long edits must pause before the list is read again, the same wait LiveSegmentMesh
// gives edits before it rebuilds a mesh. A brush drag fires an edit on every step, so
// reading on each one would re-render the page, and mount a live mesh whose first
// surface extraction scans the whole labelmap, in the middle of the stroke.
export const EDITED_CATALOG_SETTLE_MS = 400;

const NONE: number[] = [];

// Catalog classes edited on this case switch from their baked mesh to a live
// surface. Per-segment revisions avoid rebuilding unrelated edited organs.
export function useEditedCatalogIds(caseId: string, catalogSize: number): { ids: number[]; revisions: Record<number, number>; refresh: (segmentIndex?: number) => void } {
	const [state, setState] = useState<{ caseId: string; ids: number[]; revisions: Record<number, number> }>({ caseId: "", ids: NONE, revisions: {} });
	const current = useRef({ caseId, catalogSize });
	useEffect(() => {
		current.current = { caseId, catalogSize };
	}, [caseId, catalogSize]);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const refresh = useCallback((segmentIndex?: number) => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			const { caseId: id, catalogSize: size } = current.current;
			const ids = [...getEditedSegments()].filter((n) => n > 0 && n <= size).sort((a, b) => a - b);
			setState((prev) => {
				const unchanged = prev.caseId === id && ids.length === prev.ids.length && ids.every((value, index) => value === prev.ids[index]);
				const revisions = prev.caseId === id ? { ...prev.revisions } : {};
				const touched = segmentIndex != null && ids.includes(segmentIndex) ? [segmentIndex] : ids;
				for (const touchedId of touched) revisions[touchedId] = (revisions[touchedId] ?? 0) + 1;
				return { caseId: id, ids: unchanged ? prev.ids : ids, revisions };
			});
		}, EDITED_CATALOG_SETTLE_MS);
	}, []);
	useEffect(() => {
		const unsubscribe = subscribeToSegmentationEdits((detail) => refresh(detail?.segmentIndex));
		return () => {
			unsubscribe();
			clearTimeout(timer.current);
		};
	}, [refresh]);
	return { ids: state.caseId === caseId ? state.ids : NONE, revisions: state.caseId === caseId ? state.revisions : {}, refresh };
}
