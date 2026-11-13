/**
 * Refinement shares the annotation ribbon's AI slot (the label and when it shows
 * as "AI refine" are tested here); the flyout it opens is RefineFlyout.tsx, whose
 * failure messages are tested in refineFlyoutErrors.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { aiSlotCopy, deriveToolbarState, toolbarLayout } from "../components/viewer/annotationToolbarState";

describe("current AI refine entry point", () => {
	it("labels the shared AI slot as refine only when the target already has a mask", () => {
		const emptyState = deriveToolbarState({ hasActiveTarget: true, hasTargetSegmentation: false, activeTool: null });
		const maskedState = deriveToolbarState({ hasActiveTarget: true, hasTargetSegmentation: true, activeTool: null });

		expect(toolbarLayout(emptyState, null).ai).toBe("start");
		expect(aiSlotCopy("start", null).label).toBe("AI segment");
		expect(toolbarLayout(maskedState, null).ai).toBe("refine");
		expect(aiSlotCopy("refine", null).label).toBe("AI refine");
	});

	it("shows the armed prompt tool in place of the general refine label", () => {
		expect(aiSlotCopy("refine", "boxSegment").label).toBe("AI: Box");
	});
});
