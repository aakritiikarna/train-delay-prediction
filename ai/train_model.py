import pandas as pd
import numpy as np
from catboost import CatBoostRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import pickle

# Load dataset
df = pd.read_csv('../data/train_delays.csv')

# Generate synthetic train ID
df['train_id'] = df['Train Type'].str[:2].str.upper() + '-' + df.index.astype(str).str.zfill(3)

# Features and target
X = df[[
    'Distance Between Stations (km)',
    'Weather Conditions',
    'Day of the Week',
    'Time of Day',
    'Train Type',
    'Route Congestion'
]]
y = df['Historical Delay (min)']

# Train/test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train CatBoost model (native categorical handling)
model = CatBoostRegressor(
    iterations=500,
    depth=6,
    learning_rate=0.1,
    loss_function='MAE',
    cat_features=['Weather Conditions', 'Day of the Week', 'Time of Day', 'Train Type', 'Route Congestion'],
    random_seed=42,
    verbose=False
)

model.fit(X_train, y_train)

# Evaluate
preds = model.predict(X_test)
print(f"Mean Absolute Error: {mean_absolute_error(y_test, preds):.2f} minutes")

# Save model
with open('model.pkl', 'wb') as f:
    pickle.dump(model, f)

print("CatBoost model saved!")
