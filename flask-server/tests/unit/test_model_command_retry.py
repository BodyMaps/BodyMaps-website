"""A model command that fails within seconds is run once more; its own error text reaches the log.

On the live site R-Super and Atlas-Net runs ended in 4 to 8 seconds on a scan that ran fine minutes later, and the only
trace was "Exit code: 1". These tests pin the repeat (and the cases where it must not happen) and the logging.
"""
import subprocess

import pytest

from services import auto_segmentor as seg


class Clock:
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(seg.time, "monotonic", c.monotonic)
    monkeypatch.setattr(seg.time, "sleep", c.sleep)
    monkeypatch.setattr(seg, "_current_session_cancelled", lambda: False)
    return c


def _failing(clock, runs, seconds=5, output=b"CUDA error: out of memory"):
    """A fake _tracked_run: each call takes ``seconds``, and the first ``fail`` calls fail."""
    state = {"calls": 0}

    def fake(cmd, **kwargs):
        state["calls"] += 1
        clock.now += seconds
        if runs[min(state["calls"], len(runs)) - 1] == "fail":
            raise subprocess.CalledProcessError(1, cmd, output=output)
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    return fake, state


def test_a_run_that_works_is_run_once(monkeypatch, clock):
    fake, state = _failing(clock, ["ok"])
    monkeypatch.setattr(seg, "_tracked_run", fake)
    seg._run_model_command("model --go", check=True)
    assert state["calls"] == 1


def test_a_failure_within_seconds_is_run_once_more_and_can_succeed(monkeypatch, clock, capsys):
    fake, state = _failing(clock, ["fail", "ok"])
    monkeypatch.setattr(seg, "_tracked_run", fake)
    result = seg._run_model_command("model --go", check=True)
    assert state["calls"] == 2 and result.returncode == 0
    out = capsys.readouterr().out
    assert "CUDA error: out of memory" in out  # the model's own text is in the log
    assert "running it once more" in out


def test_two_quick_failures_raise_the_original_error_after_exactly_two_runs(monkeypatch, clock, capsys):
    fake, state = _failing(clock, ["fail", "fail"])
    monkeypatch.setattr(seg, "_tracked_run", fake)
    with pytest.raises(subprocess.CalledProcessError):
        seg._run_model_command("model --go", check=True)
    assert state["calls"] == 2
    assert capsys.readouterr().out.count("CUDA error: out of memory") == 2


def test_a_run_that_worked_for_a_while_is_not_repeated(monkeypatch, clock):
    fake, state = _failing(clock, ["fail", "ok"], seconds=seg.QUICK_FAILURE_SECONDS + 1)
    monkeypatch.setattr(seg, "_tracked_run", fake)
    with pytest.raises(subprocess.CalledProcessError):
        seg._run_model_command("model --go", check=True)
    assert state["calls"] == 1  # it failed on the scan, not on starting


def test_a_cancelled_run_is_never_repeated(monkeypatch, clock):
    fake, state = _failing(clock, ["fail", "ok"])
    monkeypatch.setattr(seg, "_tracked_run", fake)
    monkeypatch.setattr(seg, "_current_session_cancelled", lambda: True)
    with pytest.raises(subprocess.CalledProcessError):
        seg._run_model_command("model --go", check=True)
    assert state["calls"] == 1


def test_a_cancel_during_the_pause_stops_the_repeat(monkeypatch, clock):
    fake, state = _failing(clock, ["fail", "ok"])
    monkeypatch.setattr(seg, "_tracked_run", fake)
    answers = iter([False, True])  # not cancelled when it failed, cancelled by the end of the pause
    monkeypatch.setattr(seg, "_current_session_cancelled", lambda: next(answers))
    with pytest.raises(subprocess.CalledProcessError):
        seg._run_model_command("model --go", check=True)
    assert state["calls"] == 1


def test_the_repeat_is_the_same_command_with_the_same_options(monkeypatch, clock):
    seen = []

    def fake(cmd, **kwargs):
        seen.append((cmd, kwargs))
        clock.now += 2
        if len(seen) == 1:
            raise subprocess.CalledProcessError(1, cmd)
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    monkeypatch.setattr(seg, "_tracked_run", fake)
    seg._run_model_command("model --go", shell=True, check=True, cwd="/src")
    assert seen[0] == seen[1] == ("model --go", {"shell": True, "check": True, "cwd": "/src"})


# ---- what reaches the log ---------------------------------------------------------------------------------

def test_the_log_keeps_only_the_end_of_a_very_long_output(capsys):
    error = subprocess.CalledProcessError(2, "model --go", output=("noise\n" * 5000 + "THE REAL REASON").encode())
    seg._log_failed_output(error)
    out = capsys.readouterr().out
    assert "THE REAL REASON" in out and len(out) < seg._OUTPUT_TAIL_CHARS + 600
    assert "exited with code 2" in out


def test_the_log_reads_text_and_binary_and_both_streams(capsys):
    seg._log_failed_output(subprocess.CalledProcessError(1, "x", output="from stdout ", stderr=b"from stderr \xff"))
    out = capsys.readouterr().out
    assert "from stdout" in out and "from stderr" in out


def test_an_empty_capture_is_not_mistaken_for_an_uncaptured_one(capsys):
    seg._log_failed_output(subprocess.CalledProcessError(1, "x", output=b""))
    assert "it printed nothing" in capsys.readouterr().out
    seg._log_failed_output(subprocess.CalledProcessError(1, "x"))  # output went straight to the server log
    assert "not captured here" in capsys.readouterr().out


# ---- the two wired-in call sites ---------------------------------------------------------------------------

def test_rsuper_uses_the_retrying_runner_and_still_reports_failure_as_before(monkeypatch, tmp_path, clock):
    calls = []

    def fake(cmd, **kwargs):
        calls.append(cmd)
        clock.now += 5
        raise subprocess.CalledProcessError(1, cmd, output=b"boom")

    monkeypatch.setattr(seg, "_tracked_run", fake)
    monkeypatch.setattr(seg, "get_least_used_gpu", lambda: "0")
    monkeypatch.setattr(seg, "_resolve_conda_exe", lambda: "conda")
    ct = tmp_path / "ct.nii.gz"
    ct.write_bytes(b"ct")
    with pytest.raises(RuntimeError, match="inference failed"):
        seg._run_rsuper_inference(str(ct), str(tmp_path / "session"), model="R-Super-Pancreas-Kidney")
    assert len(calls) == 2  # tried, then once more


def test_a_scan_that_fails_slowly_is_not_run_twice_by_rsuper(monkeypatch, tmp_path, clock):
    calls = []

    def fake(cmd, **kwargs):
        calls.append(cmd)
        clock.now += 120
        raise subprocess.CalledProcessError(1, cmd, output=b"boom")

    monkeypatch.setattr(seg, "_tracked_run", fake)
    monkeypatch.setattr(seg, "get_least_used_gpu", lambda: "0")
    monkeypatch.setattr(seg, "_resolve_conda_exe", lambda: "conda")
    ct = tmp_path / "ct.nii.gz"
    ct.write_bytes(b"ct")
    with pytest.raises(RuntimeError, match="inference failed"):
        seg._run_rsuper_inference(str(ct), str(tmp_path / "session"), model="R-Super-Pancreas-Kidney")
    assert len(calls) == 1


# ---- Atlas-Net: "ran, wrote nothing" within seconds was the other failure seen on the live site -----------------

@pytest.fixture
def atlasnet(monkeypatch, tmp_path, clock):
    monkeypatch.setattr(seg, "_stage_nifti_gz", lambda src, dst: None)
    monkeypatch.setattr(seg, "_resolve_conda_exe", lambda: "conda")
    monkeypatch.setattr(seg, "_env_command", lambda *args, **kwargs: "conda run python")
    monkeypatch.setattr(seg, "_remap_combined_labels", lambda path, mapping: None)
    ct = tmp_path / "ct.nii.gz"
    ct.write_bytes(b"ct")
    session = tmp_path / "session"
    case_pred = session / "atlasnet" / "out" / f"{seg._normalize_case_id(str(ct))}.nii.gz"
    return str(ct), str(session), case_pred


def _atlas_runner(clock, case_pred, writes_on, seconds):
    state = {"calls": 0}

    def fake(cmd, **kwargs):
        state["calls"] += 1
        clock.now += seconds
        if state["calls"] in writes_on:
            case_pred.parent.mkdir(parents=True, exist_ok=True)
            case_pred.write_bytes(b"mask")
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    return fake, state


def test_atlasnet_that_wrote_nothing_within_seconds_is_run_once_more(monkeypatch, atlasnet, clock):
    ct, session, case_pred = atlasnet
    fake, state = _atlas_runner(clock, case_pred, writes_on={2}, seconds=5)
    monkeypatch.setattr(seg, "_tracked_run", fake)
    out = seg._run_atlasnet_inference(ct, session, "conda", "env")
    assert state["calls"] == 2 and out.endswith("ct")


def test_atlasnet_that_never_writes_its_output_still_fails_after_two_runs(monkeypatch, atlasnet, clock):
    ct, session, case_pred = atlasnet
    fake, state = _atlas_runner(clock, case_pred, writes_on=set(), seconds=5)
    monkeypatch.setattr(seg, "_tracked_run", fake)
    with pytest.raises(RuntimeError, match="Expected Atlas-Net output not found"):
        seg._run_atlasnet_inference(ct, session, "conda", "env")
    assert state["calls"] == 2


def test_atlasnet_that_ran_for_a_while_and_wrote_nothing_is_not_run_again(monkeypatch, atlasnet, clock):
    ct, session, case_pred = atlasnet
    fake, state = _atlas_runner(clock, case_pred, writes_on={2}, seconds=seg.QUICK_FAILURE_SECONDS + 10)
    monkeypatch.setattr(seg, "_tracked_run", fake)
    with pytest.raises(RuntimeError, match="Expected Atlas-Net output not found"):
        seg._run_atlasnet_inference(ct, session, "conda", "env")
    assert state["calls"] == 1


def test_atlasnet_that_wrote_its_output_is_run_once(monkeypatch, atlasnet, clock):
    ct, session, case_pred = atlasnet
    fake, state = _atlas_runner(clock, case_pred, writes_on={1}, seconds=5)
    monkeypatch.setattr(seg, "_tracked_run", fake)
    seg._run_atlasnet_inference(ct, session, "conda", "env")
    assert state["calls"] == 1
