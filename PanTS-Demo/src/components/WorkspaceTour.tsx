import { useEffect, useRef, useState } from "react";
import "./WorkspaceTour.css";

const SEEN_KEY = "bodymaps.workspace-tour.v6";
const STEPS = [
  { target: "explore", title: "Your imaging workspace", text: "Explore the CT library, meet the team, or return to your workspace. Your account keeps protected features available after sign-in." },
  { target: "mobile-navigation", title: "Your imaging workspace", text: "Open the navigation menu to explore the dataset, return to your workspace, or find your account settings." },
  { target: "composer", title: "Start with a CT scan", text: "Choose NIfTI files or a DICOM series. Preview your scan before selecting a pipeline. View-only mode keeps the file in your browser." },
  { target: "pipeline", title: "Choose your pipeline", text: "Choose a model available to your account. Optional OpenVAE reconstruction and ShapeKit organ refinement appear when the server supports them. Run processes the selected steps on the server; progress shows their actual status." },
  { target: "recent", title: "Pick up where you left off", text: "Recent runs show their real status. Open a completed result or see all your runs in History. Starting a new run never deletes earlier results." },
  { target: "settings", title: "Make it yours", text: "Open Settings to edit your profile and picture, check your plan, or manage privacy. You can replay this walkthrough here anytime." },
];

export default function WorkspaceTour({ replay }: { replay: number }) {
  const [step, setStep] = useState<number | null>(null);
  const [steps, setSteps] = useState(STEPS);
  const card = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = () => {
    try { localStorage.setItem(SEEN_KEY, "true"); } catch { /* optional tour preference */ }
    setStep(null);
    // Replay may start from a menu item that is removed, or from the mobile
    // drawer that closes when the tour opens. Return to a visible control in
    // that case instead of leaving keyboard focus on the document body.
    const returnTargets = [
      previousFocus.current,
      document.querySelector<HTMLElement>('[data-tour="mobile-navigation"] button[aria-controls="design-sidebar"]'),
      document.querySelector<HTMLElement>('[data-tour="settings"] button[aria-haspopup="menu"]'),
      document.getElementById("workspace-content"),
    ];
    for (const target of returnTargets) {
      if (!target?.isConnected || target === document.body || !target.getClientRects().length
        || target.matches(":disabled") || target.closest('[inert],[hidden],[aria-hidden="true"]')
        || ["hidden", "collapse"].includes(getComputedStyle(target).visibility)) continue;
      target.focus();
      if (document.activeElement === target) break;
    }
  };
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "true"; } catch { seen = true; }
    if (seen && replay === 0) return;
    const timer = window.setTimeout(() => {
      previousFocus.current = document.activeElement as HTMLElement;
      const available = STEPS.filter((item) => {
        const target = document.querySelector(`[data-tour="${item.target}"]`);
        return target && target.getClientRects().length > 0;
      });
      setSteps(available.length ? available : [{ target: "", title: "Welcome to BodyMaps", text: "Browse CT cases, start a scan pipeline, and manage your account. Open the navigation menu to find each feature. You can replay this introduction from Settings." }]);
      setStep(0);
    }, replay ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [replay]);
  useEffect(() => {
    if (step === null) return;
    const target = document.querySelector(`[data-tour="${steps[step].target}"]`);
    target?.classList.add("design-tour-target");
    // A rendered target may still sit outside a short/mobile viewport. Bring
    // each step into view without moving keyboard focus out of the dialog.
    target?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center",
      inline: "nearest",
    });
    card.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const buttons = card.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { target?.classList.remove("design-tour-target"); document.removeEventListener("keydown", keydown); };
  }, [step, steps]);
  if (step === null) return null;
  return <div className="design-tour-backdrop">
    <div ref={card} className="design-tour-card" role="dialog" aria-modal="true" aria-labelledby="workspace-tour-title" aria-describedby="workspace-tour-description" tabIndex={-1}>
      <div className="design-tour-top"><span>Welcome to BodyMaps</span><button type="button" onClick={close}>Skip tour</button></div>
      <h2 id="workspace-tour-title">{steps[step].title}</h2>
      <p id="workspace-tour-description">{steps[step].text}</p>
      <div className="design-tour-bottom"><span aria-live="polite">{step + 1} of {steps.length}</span><div><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button><button type="button" className="design-tour-next" onClick={() => step === steps.length - 1 ? close() : setStep(step + 1)}>{step === steps.length - 1 ? "Get started" : "Next"}</button></div></div>
    </div>
  </div>;
}
