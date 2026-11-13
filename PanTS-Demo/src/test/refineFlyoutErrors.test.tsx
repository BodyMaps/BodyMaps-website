/**
 * What a person sees when "Refine with model" fails. The request layer words a full
 * model server as HTTP 429 ("Server is busy...") and a down or stalled one as
 * "Server error (5xx)...", and neither used to match the flyout's known messages, so
 * every one of them read as a generic "Refining failed" with no hint to wait.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RefineFlyout from "../components/segmentation/RefineFlyout";

const BUSY = "The interactive model is busy. Wait a moment and try again.";
const UNAVAILABLE = "The interactive model is unavailable right now. Try again in a moment.";

async function failWith(error: unknown) {
	const refine = vi.fn().mockRejectedValue(error);
	render(<RefineFlyout classLabel="Liver" refine={refine} />);
	fireEvent.click(screen.getByRole("button", { name: /Refine Liver/ }));
	return (await screen.findByRole("alert")).textContent;
}

describe("RefineFlyout failure messages", () => {
	it.each([
		["a 429 from the request layer", "Server is busy (too many requests). Please wait a moment and try again."],
		["the backend's capacity wording", "Interactive segmentation is at capacity - please retry in a few seconds."],
		["a stalled model server", "Interactive segmentation timed out - the server is busy. Please retry."],
	])("says the model is busy for %s", async (_name, message) => {
		expect(await failWith(new Error(message))).toBe(BUSY);
	});

	it.each([
		["503", "Server error (503). Please try again later. If this keeps happening, try reloading or contact support."],
		["502", "Server error (502). Please try again later. If this keeps happening, try reloading or contact support."],
	])("says the model is unavailable for a %s", async (_code, message) => {
		expect(await failWith(new Error(message))).toBe(UNAVAILABLE);
	});

	it("keeps the specific messages it already knew", async () => {
		const known = "This class has no voxels to refine yet. Draw or segment it first.";
		expect(await failWith(new Error(known))).toBe(known);
	});

	it("keeps the network wording for a failed fetch", async () => {
		expect(await failWith(new TypeError("Failed to fetch"))).toBe(
			"Could not reach the model server. Check your connection and try again.",
		);
	});

	it("still falls back to the generic message for anything else", async () => {
		expect(await failWith(new Error("Some unexpected failure"))).toBe("Refining failed. Try again.");
	});
});
