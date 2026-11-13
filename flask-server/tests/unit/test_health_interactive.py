"""/api/health reports this backend's model leases so "busy" can be told apart from "broken"."""
from flask import Flask

from services import nninteractive_predictor as predictor


def _health_json():
    from api.api_blueprint import health

    app = Flask(__name__)
    with app.test_request_context("/api/health"):
        response = health()
    return response.get_json()


def test_health_includes_the_model_lease_counts():
    body = _health_json()
    assert body["interactive"]["max"] == predictor._MAX_SESSIONS
    assert body["interactive"]["leases"] == len(predictor._SESSIONS)


def test_health_still_answers_when_the_lease_stats_fail(monkeypatch):
    def boom():
        raise RuntimeError("model client missing")

    monkeypatch.setattr(predictor, "slot_stats", boom)
    body = _health_json()
    assert body["interactive"] is None
    assert body["status"] in {"ok", "degraded"}
