import type { ReactNode } from "react";
import { formatRelativeTime, type RecentUpload } from "../helpers/recentUploads";
import "./WorkspaceRunCard.css";

type Props = {
  upload: RecentUpload;
  phase?: string;
  queuePosition?: number;
  estimate?: string;
  closeNote?: string;
  actions?: ReactNode;
};

/** Presentation of observed run state, never a timer-driven simulation. */
export default function WorkspaceRunCard({ upload, phase, queuePosition, estimate, closeNote, actions }: Props) {
  const complete = upload.status === "Completed";
  const stopped = upload.status === "Failed" || upload.status === "Cancelled";
  const observedStages = upload.pipelineStages?.length ? upload.pipelineStages : undefined;
  // A terminal response supersedes the previous queue/running observation.
  if (stopped) phase = undefined;
  const transferring = phase === "uploading" || phase === "waiting";
  const admitted = phase === "queued" || phase === "running" || complete || !!observedStages;
  const headline = complete ? "Your results are ready" : stopped ? `Run ${upload.status.toLowerCase()}`
    : phase === "waiting" ? "Waiting to upload" : phase === "uploading" ? "Uploading your scan"
    : phase === "queued" ? (queuePosition ? `Number ${queuePosition} in the GPU queue` : "Queued for GPU")
    : phase === "running" ? "Processing your scan" : "Checking run status";
  const steps = [
    { label: "Upload scan", detail: admitted ? "Scan received" : phase === "waiting" ? "Waiting for the current transfer" : phase === "uploading" ? "Transferring scan data" : "",
      state: admitted ? "done" : transferring && !stopped ? "active" : "pending" },
    ...(observedStages ? observedStages.map((stage) => ({
      label: stage.id === "preprocessing" ? `Reconstruct CT · ${stage.model}` : stage.id === "segmentation" ? `Segment scan · ${stage.model}`
        : stage.id === "postprocessing" ? `Refine organ masks · ${stage.model}` : "Prepare results",
      detail: stage.status === "completed" ? "Step completed" : stage.status === "failed" ? "Step failed"
        : stage.status === "cancelled" ? "Step cancelled" : stage.status === "running" && !stopped ? "Running on the server" : "Waiting for this step",
      state: stage.status === "completed" ? "done" : stage.status === "failed" || stage.status === "cancelled" ? "stopped"
        : stage.status === "running" && !stopped ? "active" : "pending",
    })) : [{ label: "Process pipeline", detail: complete ? "Processing complete" : phase === "queued" ? "Waiting for an available GPU" : phase === "running" ? "Running the selected pipeline" : "",
      state: complete ? "done" : (phase === "queued" || phase === "running") && !stopped ? "active" : "pending" }]),
    { label: "Results", detail: complete ? "Ready to open in the viewer" : stopped ? "No completed result" : "Available when processing finishes",
      state: complete ? "done" : stopped ? "stopped" : "pending" },
  ];
  return <article className={`workspace-run-card status-${upload.status.toLowerCase()}`} aria-label={`Run: ${upload.label}`}>
    <div className="workspace-run-request">
      <span className="workspace-run-file-icon" aria-hidden="true">↥</span>
      <div className="workspace-run-file"><strong title={upload.sourceName || upload.label}>{upload.sourceName || upload.label}</strong>
        <span>{upload.label} · {formatRelativeTime(upload.timestamp)}</span></div>
      <div className="workspace-run-chips">
        {upload.pipeline?.preprocessing && <span><small>Preprocessing</small>{upload.pipeline.preprocessing}</span>}
        <span><small>Model</small>{upload.model}</span>
        {upload.pipeline?.postprocessing && <span><small>Postprocessing</small>{upload.pipeline.postprocessing}</span>}
      </div>
    </div>
    <div className="workspace-run-response">
      <img src="/bodymaps-logo.svg" alt="" />
      <div className="workspace-run-body">
        <h3 aria-live="polite">{headline}</h3>
        <ol className="workspace-run-steps" aria-label="Pipeline progress">
          {steps.map((step) => <li key={step.label} className={`is-${step.state}`} aria-current={step.state === "active" ? "step" : undefined}>
            <span className="workspace-run-step-icon" aria-hidden="true">{step.state === "done" ? "✓" : step.state === "stopped" ? "!" : "○"}</span>
            <div><strong>{step.label}</strong>{step.detail && <p>{step.detail}</p>}</div>
            <small>{step.state === "done" ? "Complete" : step.state === "active" ? "In progress" : step.state === "stopped" ? upload.status : "Pending"}</small>
          </li>)}
        </ol>
        {phase === "running" && !stopped && !complete && estimate && <p className="workspace-run-note">Estimated timing: {estimate}</p>}
        {upload.pipeline?.preprocessing === "OpenVAE" && observedStages?.some((stage) => stage.id === "segmentation" && stage.status === "completed")
          && <p className="workspace-run-note">Segmentation used the reconstructed CT; the viewer retains the original CT.</p>}
        {closeNote && !stopped && !complete && <p className="workspace-run-note">{closeNote}</p>}
        {stopped && <p className="workspace-run-note">{upload.status === "Cancelled" ? "This run was cancelled." : "This run did not complete. Select your scan again to start another run."}</p>}
        {actions && <div className={`workspace-run-actions${complete ? " is-result" : ""}`}>
          {complete && <div className="workspace-result-summary"><strong>{upload.isReconstruction ? "Reconstruction ready" : "Segmentation ready"}</strong>
            <p>{upload.isReconstruction ? "Reconstructed CT is ready to open in the viewer." : "Masks are ready to open in the viewer."}</p></div>}
          {actions}</div>}
      </div>
    </div>
  </article>;
}
