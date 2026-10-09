// Uploads outlive the page that started them. Leaving /upload unmounts the page,
// but an upload or a run request already under way carries on in the old page's
// closures, and the page mounted on return used to start the same session again:
// a second copy of the file racing the first to finalize, a second run request,
// or a poll for a job that did not exist yet, which marked the run Failed after
// three misses. So the abort controllers, the upload progress and a hold on every
// session whose upload or run request is still going live here, where every
// mount of the page sees them. A held session is left to finish, and the page
// that is showing takes it up from the state it ended in.

/** One AbortController per session with an upload or run request in flight. */
export const uploadControllers = new Map<string, AbortController>();
/** Bytes still to send per session, summed for the "safe to close" line. */
export const uploadRemaining = new Map<string, number>();
/** Bytes this tab has put on the wire; the page diffs it to measure throughput. */
export const uploadBytesSent = { current: 0 };
/** Whether the upload on the wire has a resumable IndexedDB copy. */
export const uploadResumable = { current: false };

type SessionHold = { count: number; settled: Promise<void>; settle: () => void };
const sessionHolds = new Map<string, SessionHold>();

/** Holds a session until the returned release is called (calling it twice is harmless). */
export const holdSession = (sid: string): (() => void) => {
	let hold = sessionHolds.get(sid);
	if (!hold) {
		let settle!: () => void;
		const settled = new Promise<void>((resolve) => { settle = resolve; });
		hold = { count: 0, settled, settle };
		sessionHolds.set(sid, hold);
	}
	const held = hold;
	held.count += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		held.count -= 1;
		if (held.count === 0) {
			if (sessionHolds.get(sid) === held) sessionHolds.delete(sid);
			held.settle();
		}
	};
};

/** Settles once nothing in this tab holds the session; undefined when nothing holds it now. */
export const sessionReleased = (sid: string): Promise<void> | undefined => sessionHolds.get(sid)?.settled;

/** Stops and forgets everything above. It belongs to the tab rather than to a mounted
 * page, so in a test file it would otherwise outlive the test that filled it. */
export const resetUploadTabState = (): void => {
	uploadControllers.forEach((controller) => controller.abort());
	uploadControllers.clear();
	uploadRemaining.clear();
	uploadBytesSent.current = 0;
	uploadResumable.current = false;
	sessionHolds.forEach((hold) => hold.settle());
	sessionHolds.clear();
};
