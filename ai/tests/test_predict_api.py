import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from predict_api import create_app  # noqa: E402

VALID = {"distance": 150, "weather": "Rainy", "day": "Monday", "time_of_day": "Morning",
         "train_type": "Express", "congestion": "High"}


@pytest.fixture()
def client():
    return create_app().test_client()


def test_health_reports_model_version(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json["status"] == "ok" and res.json["model_version"]


def test_valid_prediction_is_a_non_negative_number(client):
    res = client.post("/predict", json=VALID)
    assert res.status_code == 200
    assert isinstance(res.json["predicted_delay"], float) and res.json["predicted_delay"] >= 0
    assert res.json["warnings"] == []


def test_prediction_is_deterministic(client):
    assert client.post("/predict", json=VALID).json == client.post("/predict", json=VALID).json


def test_longer_distance_means_longer_predicted_delay(client):
    short = client.post("/predict", json={**VALID, "distance": 50}).json["predicted_delay"]
    long_ = client.post("/predict", json={**VALID, "distance": 600}).json["predicted_delay"]
    assert long_ > short


@pytest.mark.parametrize("patch", [
    {"weather": "Snow"}, {"day": "Funday"}, {"time_of_day": None}, {"train_type": 5}, {"congestion": "Huge"},
    {"distance": "abc"}, {"distance": -1}, {"distance": 10**9}, {"distance": True}, {"distance": float("nan")},
])
def test_invalid_fields_are_rejected_with_400(client, patch):
    res = client.post("/predict", data=json.dumps({**VALID, **patch}), content_type="application/json")
    assert res.status_code == 400
    assert res.json["error"] == "Invalid input" and res.json["details"]


def test_missing_fields_and_non_object_bodies_are_rejected(client):
    assert client.post("/predict", json={}).status_code == 400
    assert client.post("/predict", json=[1, 2]).status_code == 400
    assert client.post("/predict", data="not json", content_type="application/json").status_code == 400


def test_out_of_training_range_distance_returns_a_warning(client):
    res = client.post("/predict", json={**VALID, "distance": 1800})
    assert res.status_code == 200
    assert res.json["warnings"] and "trained on" in res.json["warnings"][0]


def test_api_key_is_enforced_when_configured():
    c = create_app(api_key="s3cret").test_client()
    assert c.post("/predict", json=VALID).status_code == 401
    assert c.post("/predict", json=VALID, headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.post("/predict", json=VALID, headers={"X-API-Key": "s3cret"}).status_code == 200
    assert c.get("/health").status_code == 200  # health stays open for platform probes


def test_model_info_exposes_metrics_and_categories(client):
    info = client.get("/model-info").json
    assert info["metrics"]["mae"] < info["metrics"]["baseline_median_mae"]
    assert "Rainy" in info["categories"]["Weather Conditions"]


def test_oversized_body_is_rejected(client):
    res = client.post("/predict", data="x" * 20000, content_type="application/json")
    assert res.status_code == 413
