# TrainTrack AI

Train disruption tracking, dispatch scheduling and ML delay prediction.
Express 5 + MongoDB (Mongoose) + Socket.io, a vanilla-JS frontend, and a Flask/CatBoost prediction microservice.

> Status: work in progress. See **IMPLEMENTATION_STATUS.md** for exactly what is done, what isn't, and how to continue.

## Features (implemented and tested)
- Email/password auth (bcrypt, JWT in an httpOnly cookie), roles `passenger` / `controller` / `admin`, enforced on the API **and** on the `/controller` and `/admin` pages.
- Disruptions and train schedules with search, filters, pagination, CSV export, and real-time updates over Socket.io.
- Admin panel: create/update/deactivate/delete users, audit log, contact-message inbox.
- Delay prediction: browser -> Node (`POST /api/predictions`) -> Flask/CatBoost.
- Security: zod validation, rate limiting, Helmet with a strict CSP, no inline scripts/styles, safe DOM rendering (no `innerHTML` with data), regex-escaped search, mass-assignment protection.

> **About the model:** the bundled dataset (`data/train_delays.csv`) has unknown provenance and the model scores R² 0.96 on it, which strongly suggests synthetic data. Treat the predictor as a demonstration of the pipeline, not a validated operational forecaster.

## Run locally
Prerequisites: Node >= 20, Python >= 3.11, a MongoDB instance (local or Atlas).

```bash
npm install
cp .env.example .env            # then edit MONGO_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed                    # creates the admin user + demo trains/disruptions (idempotent)
npm run import:dataset          # loads data/train_delays.csv for the trend chart

# ML service (second terminal)
cd ai && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python predict_api.py           # http://127.0.0.1:5000

# App (first terminal)
npm start                       # http://localhost:3000  (npm run dev for auto-reload)
```
Log in at `/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Self-registration only creates passenger accounts; promote users in `/admin`.

## Tests
```bash
npm test                        # uses only mongodb://127.0.0.1:27017/traintrack_isolated_test; DROPS that database
npm run lint
cd ai && pip install -r requirements-dev.txt && pytest
```
The Node integration tests never use the application's `MONGO_URI`. They validate `MONGO_URI_TEST` before connecting and refuse to run unless its database name is exactly `traintrack_isolated_test`; an already-open Mongoose connection also causes the tests to stop. If using a different MongoDB host, set `MONGO_URI_TEST` to a URI whose database path is `/traintrack_isolated_test` (PowerShell: `$env:MONGO_URI_TEST = "mongodb://127.0.0.1:27017/traintrack_isolated_test"`; Command Prompt: `set MONGO_URI_TEST=mongodb://127.0.0.1:27017/traintrack_isolated_test`). Setup and teardown clear only this dedicated database. Do not point it at any database containing application or other user data.

Retrain the model: `cd ai && python train_model.py` (writes `model.cbm` and `model_meta.json`).

## Layout
`app.js` app factory · `server.js` bootstrap · `routes/` · `middleware/` · `models/` · `validation/schemas.js` · `services/` · `views/` + `public/` frontend · `ai/` ML service · `scripts/` seed/import · `tests/`
