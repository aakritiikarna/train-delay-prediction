"""Flask microservice that serves the CatBoost delay model.

POST /predict   JSON: distance, weather, day, time_of_day, train_type, congestion
GET  /health    liveness + model version
GET  /model-info  training metrics and the categories the model understands

Run locally:  python predict_api.py        Production:  gunicorn predict_api:app
"""
from __future__ import annotations

import hmac
import json
import math
import os
from pathlib import Path

import pandas as pd
from catboost import CatBoostRegressor
from flask import Flask, jsonify, request

HERE = Path(__file__).resolve().parent

# API field -> training column
FIELD_TO_COLUMN = {
    "weather": "Weather Conditions",
    "day": "Day of the Week",
    "time_of_day": "Time of Day",
    "train_type": "Train Type",
    "congestion": "Route Congestion",
}
DISTANCE_COLUMN = "Distance Between Stations (km)"
MAX_DISTANCE_KM = 2000


def create_app(model_dir: Path | None = None, api_key: str | None = None) -> Flask:
    model_dir = Path(model_dir or os.environ.get("MODEL_DIR", HERE))
    api_key = api_key if api_key is not None else os.environ.get("ML_API_KEY", "")

    model = CatBoostRegressor()
    model.load_model(str(model_dir / "model.cbm"))
    meta = json.loads((model_dir / "model_meta.json").read_text())
    features = meta["features"]
    categories = meta["categories"]
    low, high = meta["distance_range_km"]

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024  # these requests are tiny

    @app.before_request
    def check_api_key():
        # Optional shared secret so the public ML service can only be called by our Node API.
        if api_key and request.endpoint == "predict":
            supplied = request.headers.get("X-API-Key", "")
            if not hmac.compare_digest(supplied, api_key):
                return jsonify(error="Unauthorized"), 401
        return None

    def validate(data):
        """Returns (clean_values, errors). Never trusts types coming from the client."""
        if not isinstance(data, dict):
            return None, ["Body must be a JSON object"]
        errors, clean = [], {}
        for field, column in FIELD_TO_COLUMN.items():
            value = data.get(field)
            allowed = categories[column]
            if value not in allowed:
                errors.append(f"{field} must be one of {allowed}")
            else:
                clean[column] = value
        distance = data.get("distance")
        if isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance):
            errors.append("distance must be a number")
        elif not 0 <= distance <= MAX_DISTANCE_KM:
            errors.append(f"distance must be between 0 and {MAX_DISTANCE_KM} km")
        else:
            clean[DISTANCE_COLUMN] = float(distance)
        return clean, errors

    @app.post("/predict")
    def predict():
        clean, errors = validate(request.get_json(silent=True))
        if errors:
            return jsonify(error="Invalid input", details=errors), 400
        # A DataFrame with named columns means we can't silently mis-order features.
        row = pd.DataFrame([[clean[c] for c in features]], columns=features)
        delay = max(0.0, float(model.predict(row)[0]))  # a delay can't be negative
        warnings = []
        if not low <= clean[DISTANCE_COLUMN] <= high:
            warnings.append(
                f"Distance is outside the {low:.0f} to {high:.0f} km range the model was trained on, "
                "so treat this estimate with caution."
            )
        return jsonify(predicted_delay=round(delay, 1), warnings=warnings, model_version=meta["version"])

    @app.get("/health")
    def health():
        return jsonify(status="ok", model_version=meta["version"])

    @app.get("/model-info")
    def model_info():
        return jsonify(version=meta["version"], trained_at=meta["trained_at"], metrics=meta["metrics"],
                       categories=categories, distance_range_km=[low, high])

    return app


app = create_app() if os.environ.get("ML_SKIP_AUTOLOAD") != "1" else None

if __name__ == "__main__":
    # Development server only. Use gunicorn in production (see Dockerfile / render.yaml).
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)))
