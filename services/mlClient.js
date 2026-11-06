'use strict';
const HttpError = require('../utils/HttpError');

/** Thin client for the Flask/CatBoost prediction microservice. */
function createMlClient(env) {
  async function predict(input) {
    const body = {
      distance: input.distance,
      weather: input.weather,
      day: input.day,
      time_of_day: input.timeOfDay,
      train_type: input.trainType,
      congestion: input.congestion,
    };
    let res;
    try {
      res = await fetch(`${env.ML_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(env.ML_API_KEY ? { 'X-API-Key': env.ML_API_KEY } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.ML_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(503, 'Prediction service is unavailable right now. It may be starting up; please try again in a moment.');
    }
    if (!res.ok) throw new HttpError(502, 'Prediction service returned an error');
    const data = await res.json();
    return {
      predictedDelay: data.predicted_delay,
      warnings: data.warnings || [],
      modelVersion: data.model_version || null,
    };
  }

  async function health() {
    try {
      const res = await fetch(`${env.ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  return { predict, health };
}

module.exports = createMlClient;
