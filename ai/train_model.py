"""Train the CatBoost delay model and write model.cbm + model_meta.json.

Usage:  python train_model.py [--data ../data/train_delays.csv] [--out .]

Improvements over the original script: exact duplicate rows are removed *before* the
train/test split (otherwise identical rows land on both sides and inflate the score),
metrics are compared against a naive baseline, and the model is saved in CatBoost's
native format (not pickle) together with the metadata the API needs to validate input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

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

    raw = pd.read_csv(args.data)
    df = load_data(args.data)
    X, y = df[FEATURES], df[TARGET]
    groups = pd.util.hash_pandas_object(X, index=False).to_numpy()
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_indices, test_indices = next(splitter.split(X, y, groups))
    X_train, X_test = X.iloc[train_indices], X.iloc[test_indices]
    y_train, y_test = y.iloc[train_indices], y.iloc[test_indices]
    train_groups = set(groups[train_indices])
    test_groups = set(groups[test_indices])
    if train_groups.intersection(test_groups):
        raise SystemExit("Data leakage: identical feature groups overlap the train and test partitions")

    model = CatBoostRegressor(
        iterations=args.iterations, depth=6, learning_rate=0.1, loss_function="MAE",
        cat_features=CATEGORICAL, random_seed=SEED, verbose=False, allow_writing_files=False,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    median_baseline = np.full(len(y_test), y_train.median())
    mean_baseline = np.full(len(y_test), y_train.mean())
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, preds)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, preds))), 2),
        "r2": round(float(r2_score(y_test, preds)), 3),
        "baseline_median_mae": round(float(mean_absolute_error(y_test, median_baseline)), 2),
        "baseline_median_rmse": round(float(np.sqrt(mean_squared_error(y_test, median_baseline))), 2),
        "baseline_mean_mae": round(float(mean_absolute_error(y_test, mean_baseline)), 2),
        "baseline_mean_rmse": round(float(np.sqrt(mean_squared_error(y_test, mean_baseline))), 2),
        "test_rows": int(len(y_test)),
        "train_rows": int(len(y_train)),
    }
    print(json.dumps(metrics, indent=2))

    args.out.mkdir(parents=True, exist_ok=True)
    model.save_model(str(args.out / "model.cbm"))
    feature_group_counts = raw.groupby(FEATURES, dropna=False)[TARGET].nunique()
    timestamp_terms = ("date", "timestamp")
    route_terms = ("route id", "route name", "trip id")
    timestamp_columns = [
        column for column in raw.columns
        if any(term in column.lower() for term in timestamp_terms)
    ]
    route_columns = [
        column for column in raw.columns
        if any(term in column.lower() for term in route_terms)
    ]
    exact_duplicate_count = int(raw.duplicated().sum())
    usable_raw = raw.dropna(subset=FEATURES + [TARGET])
    meta = {
        "version": datetime.now(UTC).strftime("catboost-%Y%m%d"),
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "features": FEATURES,
        "categories": {c: sorted(df[c].unique().tolist()) for c in CATEGORICAL},
        "distance_range_km": [float(df[NUMERIC[0]].min()), float(df[NUMERIC[0]].max())],
        "metrics": metrics,
        "evaluation": {
            "split": "grouped holdout by identical feature values; 80/20 target",
            "seed": SEED,
            "time_based_split": {
                "status": "not_evaluable",
                "reason": "The dataset contains no timestamp or date column.",
            },
            "route_based_split": {
                "status": "not_evaluable",
                "reason": "The dataset contains no route, trip, or service identifier.",
            },
            "feature_group_leakage_check": {
                "status": "passed",
                "feature_groups_in_both_partitions": 0,
                "feature_groups_with_conflicting_targets": int((feature_group_counts > 1).sum()),
            },
        },
        "dataset": {
            "source_file": args.data.name,
            "sha256": hashlib.sha256(args.data.read_bytes()).hexdigest(),
            "provenance": "Unknown; supplied with this repository and not independently verified.",
            "rows_in_source": int(len(raw)),
            "rows_after_missing_values_and_exact_duplicates": int(len(df)),
            "exact_duplicate_rows_removed": exact_duplicate_count,
            "missing_rows_removed": int(len(raw) - len(usable_raw)),
            "missing_values_in_required_columns": int(raw[FEATURES + [TARGET]].isna().sum().sum()),
            "target_min": float(df[TARGET].min()),
            "target_max": float(df[TARGET].max()),
            "timestamp_columns": timestamp_columns,
            "route_identifier_columns": route_columns,
            "limitations": [
                "The dataset has unknown provenance and likely demo/synthetic characteristics.",
                "Repeated feature combinations have conflicting target values.",
                "No time-based or route-based holdout can be evaluated without timestamps or route identifiers.",
                "Offline test metrics are not evidence of real-world operational accuracy.",
            ],
        },
    }
    (args.out / "model_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Saved model.cbm and model_meta.json to {args.out}")


if __name__ == "__main__":
    main()
