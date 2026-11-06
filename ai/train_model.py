"""Train the CatBoost delay model and write model.cbm + model_meta.json.

Usage:  python train_model.py [--data ../data/train_delays.csv] [--out .]

Improvements over the original script: exact duplicate rows are removed *before* the
train/test split (otherwise identical rows land on both sides and inflate the score),
metrics are compared against a naive baseline, and the model is saved in CatBoost's
native format (not pickle) together with the metadata the API needs to validate input.
"""
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent

TARGET = "Historical Delay (min)"
NUMERIC = ["Distance Between Stations (km)"]
CATEGORICAL = ["Weather Conditions", "Day of the Week", "Time of Day", "Train Type", "Route Congestion"]
FEATURES = NUMERIC + CATEGORICAL  # order matters: the API builds its input in exactly this order
SEED = 42


def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = set(FEATURES + [TARGET]) - set(df.columns)
    if missing:
        raise SystemExit(f"Dataset is missing columns: {sorted(missing)}")
    before = len(df)
    df = df.dropna(subset=FEATURES + [TARGET]).drop_duplicates().reset_index(drop=True)
    print(f"Loaded {before} rows, kept {len(df)} after dropping NaNs and exact duplicates")
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=HERE.parent / "data" / "train_delays.csv")
    parser.add_argument("--out", type=Path, default=HERE)
    parser.add_argument("--iterations", type=int, default=500)
    args = parser.parse_args()

    df = load_data(args.data)
    X, y = df[FEATURES], df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=SEED)

    model = CatBoostRegressor(
        iterations=args.iterations, depth=6, learning_rate=0.1, loss_function="MAE",
        cat_features=CATEGORICAL, random_seed=SEED, verbose=False, allow_writing_files=False,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    baseline = np.full(len(y_test), y_train.median())
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, preds)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, preds))), 2),
        "r2": round(float(r2_score(y_test, preds)), 3),
        "baseline_median_mae": round(float(mean_absolute_error(y_test, baseline)), 2),
        "test_rows": int(len(y_test)),
        "train_rows": int(len(y_train)),
    }
    print(json.dumps(metrics, indent=2))

    args.out.mkdir(parents=True, exist_ok=True)
    model.save_model(str(args.out / "model.cbm"))
    meta = {
        "version": datetime.now(UTC).strftime("catboost-%Y%m%d"),
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "features": FEATURES,
        "categories": {c: sorted(df[c].unique().tolist()) for c in CATEGORICAL},
        "distance_range_km": [float(df[NUMERIC[0]].min()), float(df[NUMERIC[0]].max())],
        "metrics": metrics,
    }
    (args.out / "model_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Saved model.cbm and model_meta.json to {args.out}")


if __name__ == "__main__":
    main()
