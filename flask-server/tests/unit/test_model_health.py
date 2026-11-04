"""Per-model health for the admin Diagnostics page: what counts as failing, healthy
or idle, taken from the job table. Each test gets its own temp-file database."""

import importlib
from datetime import timedelta

import pytest

from models.user import SYSTEM_USER_ID as OWNER


@pytest.fixture()
def health(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'health.db'}")

    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.job  # noqa: F401
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.model_health as model_health
    importlib.reload(model_health)

    engine.reset_engine_for_tests()
    engine.create_all()
    auth_store.ensure_system_user()  # FK target for job.user_id
    yield model_health
    engine.reset_engine_for_tests()


def _run(model, status, age_hours, error=None, sid=[0]):
    """Insert one job that last changed `age_hours` ago."""
    from models.engine import session_scope
    from models.job import Job, utcnow

    sid[0] += 1
    with session_scope() as s:
        s.add(Job(session_id=f"s{sid[0]}", user_id=OWNER, model=model, status=status, error=error,
                  updated_at=utcnow() - timedelta(hours=age_hours)))


def _row(rows, model):
    return next(r for r in rows if r["model"] == model)


def test_a_model_whose_newest_run_failed_is_failing_even_with_earlier_successes(health):
    _run("Atlas-Net", "completed", 100)
    _run("Atlas-Net", "completed", 90)
    _run("Atlas-Net", "failed", 5, error="Expected Atlas-Net output not found")
    row = _row(health.model_health(), "Atlas-Net")
    assert row["status"] == "failing"
    assert (row["completed"], row["failed"]) == (2, 1)
    assert row["last_error"] == "Expected Atlas-Net output not found"
    assert row["last_success_at"] is not None


def test_a_later_success_makes_a_failing_model_healthy_again(health):
    _run("Atlas-Net", "failed", 30, error="boom")
    _run("Atlas-Net", "completed", 2)
    row = _row(health.model_health(), "Atlas-Net")
    assert row["status"] == "healthy"
    assert row["last_error"] is None
    assert row["failed"] == 1


def test_a_listed_model_nobody_ran_has_no_runs_and_is_not_a_problem(health):
    row = _row(health.model_health(), "SuPreM")
    assert row["status"] == "no_runs"
    assert (row["completed"], row["failed"]) == (0, 0)


def test_cancelled_queued_and_running_jobs_say_nothing_about_the_model(health):
    _run("ePAI", "completed", 10)
    _run("ePAI", "cancelled", 1)
    _run("ePAI", "running", 1)
    _run("ePAI", "queued", 1)
    row = _row(health.model_health(), "ePAI")
    assert row["status"] == "healthy"
    assert (row["completed"], row["failed"]) == (1, 0)


def test_runs_older_than_the_window_are_ignored(health):
    _run("LesionSegmenter", "failed", 24 * 31)
    assert _row(health.model_health(), "LesionSegmenter")["status"] == "no_runs"


def test_a_model_not_in_the_list_still_appears_and_errors_are_truncated(health):
    _run("SomeNewModel", "failed", 1, error="x" * 1000)
    row = _row(health.model_health(), "SomeNewModel")
    assert row["status"] == "failing"
    assert len(row["last_error"]) == health.ERROR_CHARS


def test_failing_models_sort_first_then_healthy_then_idle(health):
    _run("ePAI", "completed", 1)
    _run("Atlas-Net", "failed", 1)
    order = [r["status"] for r in health.model_health()]
    assert order == sorted(order, key={"failing": 0, "healthy": 1, "no_runs": 2}.get)
    assert order[0] == "failing"
