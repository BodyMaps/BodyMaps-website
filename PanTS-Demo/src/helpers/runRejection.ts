// What a person is told when the server refuses to start a run.
//
// The server checks a scan before it creates a job and answers 400, 403 or 409 with a plain-English
// sentence written for the person (not a technical one): "This file isn't a single 3D CT scan: it
// has shape [...]". Those sentences are shown as they are. Anything else (a server error, a lost
// connection) gets a fixed sentence here, never the server's own text, because that text may not be
// meant for the page.

export class RunRejectedError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

// The server's own sentence is used for these statuses only.
const SERVER_TEXT_STATUSES = new Set([400, 403, 409]);
const MAX_SERVER_TEXT = 300;
// What the page uses when the server's reply had no message at all.
export const NO_SERVER_MESSAGE = "Failed to start inference";

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Why the run did not start, in a sentence or two. */
export function runRejectionReason(err: unknown, isDicom: boolean): string {
	if (err instanceof TypeError) return "The connection to the server was lost before the run could start.";
	if (!(err instanceof RunRejectedError)) return "The server couldn't start the run.";
	const text = oneLine(err.message);
	if (SERVER_TEXT_STATUSES.has(err.status) && text && text !== NO_SERVER_MESSAGE && text.length <= MAX_SERVER_TEXT) return text;
	if (err.status === 400) {
		return isDicom
			? "The server couldn't read this DICOM series as a single 3D CT scan."
			: "The server couldn't read it as a single 3D CT scan (.nii or .nii.gz).";
	}
	if (err.status === 403) return "This upload belongs to a different account.";
	if (err.status === 409) return "The server no longer has this upload.";
	if (err.status === 429) return "The server is busy: too many runs are waiting right now.";
	if (err.status >= 500) return `The server hit an error while starting the run (error ${err.status}).`;
	return "The server couldn't start the run.";
}

/** What to do next, matched to why it failed. */
export function runRejectionAdvice(err: unknown, isDicom: boolean): string {
	const thing = isDicom ? "folder" : "file";
	const what = isDicom ? "DICOM series" : "scan";
	if (err instanceof RunRejectedError) {
		if (err.status === 400) return `Check the ${thing} and select it again.`;
		if (err.status === 403 || err.status === 409) return `Upload the ${what} again.`;
		if (err.status === 429) return `Wait a minute, then select the ${thing} again and press Run.`;
	}
	return `Select the ${thing} again and press Run to try again.`;
}

/** The status line under the composer. */
export function runRejectionMessage(err: unknown, picked: string | undefined, isDicom: boolean): string {
	const what = isDicom ? "DICOM series" : "scan";
	const name = picked || `this ${what}`;
	const reason = runRejectionReason(err, isDicom);
	// A 400 is about the file itself; anything else is about getting the run started.
	if (err instanceof RunRejectedError && err.status === 400) {
		return `${name} could not be run. ${reason} ${runRejectionAdvice(err, isDicom)}`;
	}
	return `The server couldn't start the run for ${name}. ${reason} ${runRejectionAdvice(err, isDicom)}`;
}
