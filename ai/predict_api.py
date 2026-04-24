from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np

app = Flask(__name__)
CORS(app)

# Load CatBoost model
with open('model.pkl', 'rb') as f:
    model = pickle.load(f)

@app.route('/predict', methods=['POST'])
def predict():
    data = request.json

    # Collect raw values directly
    weather     = data.get('weather', 'Clear')
    day         = data.get('day', 'Monday')
    time_of_day = data.get('time_of_day', 'Morning')
    train_type  = data.get('train_type', 'Express')
    congestion  = data.get('congestion', 'Low')
    distance    = float(data.get('distance', 20))

    # Features must match training order
    features = np.array([[distance, weather, day, time_of_day, train_type, congestion]])
    prediction = model.predict(features)[0]

    return jsonify({ 'predicted_delay': round(float(prediction), 1) })

@app.route('/health', methods=['GET'])
def health():
    return jsonify({ 'status': 'ok' })

if __name__ == '__main__':
    app.run(port=5000, debug=True)
