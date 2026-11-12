# TrainTrack AI

Train disruption tracking, dispatch scheduling and ML delay prediction.
Express 5 + MongoDB (Mongoose) + Socket.io, a vanilla-JS frontend, and a Flask/CatBoost prediction microservice.

> Status: work in progress. See **IMPLEMENTATION_STATUS.md** for exactly what is done, what isn't, and how to continue.

## Features (implemented and tested)
- Email/password auth (bcrypt, JWT in an httpOnly cookie), roles `passenger` / `controller` / `admin`, enforced on the API **and** on the `/controller` and `/admin` pages.
- Disruptions and train schedules with search, filters, pagination, CSV export, and real-time updates over Socket.io.
- Admin panel: create/update/deactivate/delete users, audit log, contact-message inbox.
- Delay prediction: browser -> Node (`POST /api/predictions`) -> Flask/CatBoost.
- Accessible cinematic homepage with an original 3D passenger-train illustration; it is decorative and does not show live train locations.
- Schematic railway map based on stored schedules and disruptions; all train markers are simulated because there is no GPS or external railway feed.
- Private notification centre, read/unread state, preferences, Socket.IO user/role targeting, verification/reset/password-change emails, and admin notification overview.
- Security: zod validation, rate limiting, Helmet with a strict CSP, no inline scripts/styles, safe DOM rendering (no `innerHTML` with data), regex-escaped search, mass-assignment protection.

> **About the model and data:** `data/train_delays.csv` has unknown provenance and likely demo/synthetic characteristics. The source has 2,878 rows, 422 exact duplicate rows, and 444 repeated feature groups with conflicting target values. The recorded model evaluation uses a seeded, grouped holdout by identical feature values (1,956 train / 500 test rows): MAE 25.28 min, RMSE 38.83 min, R² 0.966; median baseline MAE 90.03 min / RMSE 220.69 min; mean baseline MAE 117.67 min / RMSE 210.95 min. These are offline scores on this dataset, **not real-world operational accuracy**. Time-based and route-based splits cannot be evaluated because the dataset has no timestamp or route/trip identifier. Exact input groups are kept in only one partition; this does not rule out unknown collection-level leakage.

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
Log in at `/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Self-registration only creates passenger accounts; promote users in `/admin`. Email delivery is optional and requires a Resend-compatible API URL, `EMAIL_API_KEY`, and `EMAIL_FROM`. The application reports provider acceptance, not delivery; without configuration, email is explicitly reported as unavailable. Set `PUBLIC_BASE_URL` to the deployed app origin for verification and reset links.

The map uses no geographic basemap or fabricated coordinates. Its generic station nodes and moving train markers are illustrative only; schedules and disruption reports are sourced from the app database.

## Architecture and access

The Express application serves the HTML/CSS/JavaScript dashboards and JSON API. Mongoose stores users, schedules, disruptions, notifications and prediction history in MongoDB. Socket.IO broadcasts operational changes and delivers authenticated user notifications. Delay predictions go from the browser to the Node API and then to the Flask service, which loads `ai/model.cbm` and its matching `ai/model_meta.json`.

Passwords are stored as bcrypt hashes. Successful sign-in uses an HTTP-only JWT cookie; public registration creates passenger accounts only. Controllers can manage schedules and disruptions, while administrative APIs and the admin dashboard require the admin role.

## API overview

- `/api/auth/*`: registration, sign-in/out, current user, email verification, password reset and password change.
- `/api/schedules` and `/api/disruptions`: searchable public lists; role-protected schedule and disruption updates.
- `/api/predictions`: validated delay estimate from the Flask/CatBoost service.
- `/api/stats`, `/api/analytics/*`, and `/api/map/overview`: dashboard statistics and recorded-data summaries.
- `/api/notifications/*`: authenticated notifications and user preferences.
- `/api/operations/*` and `/api/admin/*`: staff operations, user management, health, audit, security and contact-message tools.
- `/health` and `/health?deep=true`: Node/database liveness and optional ML-service health.

See `routes/` for request fields, validation and role requirements. The API does not provide external railway feeds or live GPS tracking.

## Tests
```bash
npm test                        # uses only mongodb://127.0.0.1:27017/traintrack_isolated_test; DROPS that database
npm run lint
cd ai && pip install -r requirements-dev.txt && pytest
```
The Node integration tests never use the application's `MONGO_URI`. They validate `MONGO_URI_TEST` before connecting and refuse to run unless its database name is exactly `traintrack_isolated_test`; an already-open Mongoose connection also causes the tests to stop. If using a different MongoDB host, set `MONGO_URI_TEST` to a URI whose database path is `/traintrack_isolated_test` (PowerShell: `$env:MONGO_URI_TEST = "mongodb://127.0.0.1:27017/traintrack_isolated_test"`; Command Prompt: `set MONGO_URI_TEST=mongodb://127.0.0.1:27017/traintrack_isolated_test`). Setup and teardown clear only this dedicated database. Do not point it at any database containing application or other user data.

Retrain the model: `cd ai && python train_model.py` (writes `model.cbm` and `model_meta.json`).

### Windows PowerShell

```powershell
npm ci
Copy-Item .env.example .env     # edit the local values before starting
cd ai
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python predict_api.py           # keep this terminal open
```

In a second terminal at the project root, run `npm start`. PowerShell may require allowing locally created activation scripts; alternatively, invoke `ai\.venv\Scripts\python.exe ai\predict_api.py` directly. Do not run `npm run import:dataset` against a database whose historical-delay data must be retained: that import replaces the collection.

## Screenshots

No screenshots are currently included in the repository.

## Layout
`app.js` app factory · `server.js` bootstrap · `routes/` · `middleware/` · `models/` · `validation/schemas.js` · `services/` · `views/` + `public/` frontend/assets · `ai/` ML service · `scripts/` seed/import/landing assets · `tests/`
