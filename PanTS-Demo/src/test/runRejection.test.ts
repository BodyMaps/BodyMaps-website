import { describe, expect, it } from "vitest";
import {
  NO_SERVER_MESSAGE, RunRejectedError, runRejectionAdvice, runRejectionMessage, runRejectionReason,
} from "../helpers/runRejection";

const reject = (status: number, message = NO_SERVER_MESSAGE) => new RunRejectedError(status, message);

// The sentences the server writes for a scan it will not run (flask-server/api/api_blueprint.py).
const NOT_A_NIFTI = "This file couldn't be read as a NIfTI (.nii/.nii.gz) scan. It may be corrupted, incomplete, or not actually a CT file (EOFError). Please check the file and try uploading it again.";
const NOT_3D = "This file isn't a single 3D CT scan: it has shape [406, 406, 501, 1, 3], which means it has extra data beyond just X/Y/Z (for example a multi-phase scan or a vector field). Please upload a single 3D CT phase.";
const TOO_SMALL = "This file's volume is too small to be a CT scan (shape [512, 512, 1]). Please check the file and try again.";

describe("why a run did not start", () => {
  it.each([
    ["a file that is not a NIfTI", NOT_A_NIFTI],
    ["a file that is not a single 3D scan (a vector field, a multi-phase scan)", NOT_3D],
    ["a volume too small to be a CT", TOO_SMALL],
  ])("shows the server's own sentence for %s", (_name, text) => {
    expect(runRejectionReason(reject(400, text), false)).toBe(text);
    expect(runRejectionMessage(reject(400, text), "ct (1).nii.gz", false)).toBe(
      `ct (1).nii.gz could not be run. ${text} Check the file and select it again.`,
    );
  });

  it("shows the server's sentence for an upload that is not this account's or that the server lost", () => {
    expect(runRejectionReason(reject(403, "You don't have access to this session."), false)).toBe("You don't have access to this session.");
    expect(runRejectionReason(reject(409, "Upload ownership is unknown; upload the scan again."), false)).toBe("Upload ownership is unknown; upload the scan again.");
    expect(runRejectionAdvice(reject(403, "x"), false)).toBe("Upload the scan again.");
    expect(runRejectionAdvice(reject(409, "x"), true)).toBe("Upload the DICOM series again.");
  });

  it("falls back to a fixed sentence when the server gave no message", () => {
    expect(runRejectionReason(reject(400), false)).toBe("The server couldn't read it as a single 3D CT scan (.nii or .nii.gz).");
    expect(runRejectionReason(reject(400), true)).toBe("The server couldn't read this DICOM series as a single 3D CT scan.");
    expect(runRejectionReason(reject(403), false)).toBe("This upload belongs to a different account.");
    expect(runRejectionReason(reject(409), false)).toBe("The server no longer has this upload.");
  });

  it("never shows the server's own text for a busy or failing server, only a fixed sentence", () => {
    const secret = "Traceback (most recent call last): File /home/visitor/x.py";
    expect(runRejectionReason(reject(500, secret), false)).toBe("The server hit an error while starting the run (error 500).");
    expect(runRejectionReason(reject(503, secret), false)).toBe("The server hit an error while starting the run (error 503).");
    expect(runRejectionReason(reject(429, secret), false)).toBe("The server is busy: too many runs are waiting right now.");
    expect(runRejectionMessage(reject(500, secret), "scan.nii.gz", false)).not.toContain("Traceback");
    expect(runRejectionAdvice(reject(429, secret), false)).toBe("Wait a minute, then select the file again and press Run.");
  });

  it("says so when the connection was lost", () => {
    expect(runRejectionReason(new TypeError("Failed to fetch"), false)).toBe("The connection to the server was lost before the run could start.");
    expect(runRejectionMessage(new TypeError("Failed to fetch"), undefined, false)).toBe(
      "The server couldn't start the run for this scan. The connection to the server was lost before the run could start. Select the file again and press Run to try again.",
    );
  });

  it("uses a fixed sentence for anything else, and names a DICOM folder as a folder", () => {
    expect(runRejectionReason(new Error("boom"), false)).toBe("The server couldn't start the run.");
    expect(runRejectionReason(reject(418, "teapot"), false)).toBe("The server couldn't start the run.");
    expect(runRejectionMessage(reject(400, NOT_3D), "series", true)).toContain("Check the folder and select it again.");
    expect(runRejectionMessage(new Error("boom"), undefined, true)).toContain("this DICOM series");
  });

  it("ignores a server sentence that is empty, only spaces, or far too long", () => {
    expect(runRejectionReason(reject(400, "   "), false)).toBe("The server couldn't read it as a single 3D CT scan (.nii or .nii.gz).");
    expect(runRejectionReason(reject(400, "x".repeat(301)), false)).toBe("The server couldn't read it as a single 3D CT scan (.nii or .nii.gz).");
    expect(runRejectionReason(reject(400, "Line one.\n\n  Line   two."), false)).toBe("Line one. Line two.");
  });
});
