"""Per-model health, for the admin Diagnostics page.

Read from the job table, the same record the site already keeps: a model is
failing when its most recent finished run (completed or failed; a user's cancel
says nothing about the model) failed, healthy when it completed, and has no
runs when nothing finished in the window. A fix therefore shows as healthy only
once the model has run again; the page cannot know sooner.

Nothing here runs a model, touches a GPU worker or reads the disk.
"""

from datetime import timedelta

from sqlalchemy import select

from models.engine import session_scope
from models.job import STATUS_COMPLETED, STATUS_FAILED, Job, utcnow

# Models a user can pick, so one that nobody has run lately still gets a row.
# Anything else found in the job table is listed too.
LISTED_MODELS = (
    "ePAI",
    "Atlas-Net",
    "LesionSegmenter",
    "SuPreM",
    "R-Super",
    "R-Super-Pancreas-Kidney",
    "R-Super-Merlin",
)

WINDOW_DAYS = 30
ERROR_CHARS = 200

HEALTHY, FAILING, NO_RUNS = "healthy", "failing", "no_runs"


def _iso(moment):
    return moment.isoformat() if moment else None


def model_health(now=None, window_days: int = WINDOW_DAYS) -> list[dict]:
    """One row per model, failing models first, then by name.

    Times are naive UTC ISO strings, as the rest of the API sends them.
    """
    since = (now or utcnow()) - timedelta(days=window_days)
    with session_scope() as s:
        finished = s.execute(
            select(Job.model, Job.status, Job.error, Job.updated_at)
            .where(Job.status.in_((STATUS_COMPLETED, STATUS_FAILED)), Job.updated_at >= since)
            .order_by(Job.updated_at.desc())
        ).all()

    rows: dict[str, dict] = {
        name: {"model": name, "status": NO_RUNS, "completed": 0, "failed": 0,
               "last_run_at": None, "last_success_at": None, "last_error": None}
        for name in LISTED_MODELS
    }
    for model, status, error, updated_at in finished:  # newest first
        row = rows.setdefault(model, {
            "model": model, "status": NO_RUNS, "completed": 0, "failed": 0,
            "last_run_at": None, "last_success_at": None, "last_error": None,
        })
        if row["last_run_at"] is None:  # the newest finished run decides
            row["status"] = HEALTHY if status == STATUS_COMPLETED else FAILING
            row["last_run_at"] = _iso(updated_at)
            if status == STATUS_FAILED:
                row["last_error"] = (error or "")[:ERROR_CHARS] or None
        if status == STATUS_COMPLETED:
            row["completed"] += 1
            if row["last_success_at"] is None:
                row["last_success_at"] = _iso(updated_at)
        else:
            row["failed"] += 1

    order = {FAILING: 0, HEALTHY: 1, NO_RUNS: 2}
    return sorted(rows.values(), key=lambda r: (order[r["status"]], r["model"]))
