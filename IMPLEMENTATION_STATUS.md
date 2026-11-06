# Implementation Status and Handover

Snapshot date: 3 Nov 2026. Work was stopped on request; nothing below is marked done unless it was actually run.

## 1. What the original project contained
Node/Express 5 + MongoDB + Socket.io app (`server.js`, `routes/`, `models/`, `views/*.html`) with a Flask + CatBoost service (`ai/`), a 2,878-row CSV, and seed/import scripts. The README described a different project (a generic notebook ML project) and did not match the code.

## 2. Problems found in the original (confirmed by reading/running the code)
| Severity | Problem |
|---|---|
| Critical | No authentication: login/register page was a static mock; **every** API incl. `/api/admin/users` (create admin, change roles, delete) was open to anyone. |
| Critical | Stored XSS: disruption/schedule/user fields were injected with `innerHTML` in all dashboards. |
| Critical | `POST /api/disruptions` used `req.io` (undefined): the record saved, then the request errored and no real-time alert was sent. |
| High | Mass assignment (`new Model(req.body)`, `findByIdAndUpdate(id, req.body)`), unescaped `RegExp(search)` (ReDoS), no validation, wide-open CORS, no rate limiting, no security headers. |
| High | Browser called `http://localhost:5000` directly (breaks when deployed); on failure it silently showed an invented heuristic "prediction". |
| High | `npm audit`: 9 vulnerabilities (1 critical) in the pinned dependencies; `csvtojson` used but not in `package.json`; no `.gitignore`; `.env` and `node_modules` shipped in the ZIP (the `.env` held only a localhost URI, no real secret). |
| Medium | Dashboards showed hardcoded fake data (7-day on-time chart, delay-by-line chart, "Reroutes Active: 2"). Contact form pretended to send. `seed.js` wiped all collections with no guard and created users that could not log in. |
| Medium | ML: pickle model, `debug=True`, no input validation (500 on bad input), duplicate rows leaking across the train/test split. |

## 3. Changes implemented
All work is in `TrainTrack-AI-Updated/`; the original upload was not modified.

**Backend** (new/rewritten): `app.js` (factory), `server.js` (graceful shutdown), `config/{env,logger,db}.js` (fail-fast env validation), `middleware/{auth,validate,errorHandler,rateLimit}.js`, `routes/{auth,disruptions,schedules,admin,misc}.js`, `services/{audit,mlClient}.js`, `validation/schemas.js`, `utils/*`.
- Auth: bcrypt, JWT (HS256) in httpOnly SameSite=Lax cookie or Bearer header; user re-loaded per request so deactivation/role changes apply immediately; public registration can only create passengers.
- RBAC: reads of disruptions/schedules/stats public; writes need controller/admin; deletes and `/api/admin/*` admin-only; page routes gated server-side. Admin cannot demote/deactivate/delete self; last active admin protected.
- Validation (zod), pagination (`{data, meta}`), consistent error format, regex-escaped search, field whitelists, helmet CSP, rate limits, 10 KB body limit, `/health` (`?deep=true` also pings ML).
- New endpoints: `/api/auth/*`, `/api/stats`, `/api/analytics/daily`, `/api/analytics/historical`, `/api/predictions`, `/api/contact`, `/api/admin/audit-logs`, `/api/admin/messages`.
- Models: `User` (hash, timestamps), `Disruption`/`Schedule` (validators, indexes), new `HistoricalDelay`, `AuditLog`, `ContactMessage`.
- Deps upgraded; `npm audit --omit=dev` reports 0 vulnerabilities.

**Frontend** (all six pages rewritten, same dark visual identity): single `public/style.css`, `public/js/*.js` with no inline scripts/handlers/styles, DOM-based rendering, working login/register, real data in charts, Chart.js vendored locally, labels/aria/`<dialog>`/skip link, CSV export with formula-injection protection, loading/empty/error states.

**ML service (`ai/`)**: native `model.cbm` + `model_meta.json` instead of pickle; strict input validation; optional `X-API-Key`; out-of-range distance warning; non-negative output; gunicorn-ready; `train_model.py` dedupes before splitting and reports metrics vs. a baseline. **Model was retrained**: MAE 27.49 min vs 83.83 baseline, RMSE 40.73, R² 0.958 (492 test rows).
Removed: `model.pkl`, `encoders.pkl` (unused), `catboost_info/`, original README.

**Other**: `.env.example`, `.gitignore`, `eslint.config.js`, `scripts/seed.js` and `scripts/import-dataset.js` rewritten (idempotent, guarded).

### Behaviour changes to be aware of
Controller self-registration removed (admin grants roles); API responses are `{data, meta}`; ML requires all fields (no silent defaults); no more fake "heuristic" prediction (shows an error if ML is down); fake "Reroutes Active" card replaced by "Resolved (7 days)"; Alternative Routes table kept but labelled *Sample data*.

## 4. Feature status
**Complete (tested):** auth, RBAC, disruptions/schedules API, admin user management, audit log, contact form, stats/analytics endpoints, prediction proxy, ML service, rate limiting, security headers.
**Implemented, only lightly verified:** frontend pages (one manual Playwright run, see below; no automated UI tests in `npm test`).
**Partial:** pagination UI (admin has pager; other lists load up to 200 and show "Showing x of y"); schedule creation exists in the API only, there is no UI form for it.
**Not started:** Dockerfiles/compose, `render.yaml`/deployment config, CI workflow, `PROJECT_DOCUMENTATION.md`, deployment guide, screenshots, OpenAPI docs, real rerouting feature, notification/email, password reset, automated e2e in CI.

## 5. What was actually run
| Command | Result |
|---|---|
| `npm test` (node:test + supertest, real MongoDB 8.3.7) | **54 passed, 0 failed** (auth, RBAC, validation, injection, socket events, ML client with fake server, stats, headers/CSP, rate limit, contact) |
| `cd ai && pytest` | **19 passed** |
| `npx eslint .` / `ruff check ai` | clean / clean |
| `npm audit --omit=dev` | 0 vulnerabilities (`npm audit` incl. dev: 5 moderate, all ESLint -> minimatch, dev-only) |
| `python train_model.py` | metrics above |
| `npm run seed` (x2), `npm run import:dataset` | ran without error; imported 2,878 rows. I did not separately count documents after the second seed run. |
| Full stack manual run (Node :3111 + Flask + Mongo) + Playwright script (`tests/e2e/smoke.manual.js`) | Passed: pages load with no CSP violations; prediction returned a value; anonymous `/controller` redirects to login; controller login, schedule edit, `/admin` blocked for controller; admin panel loads; no horizontal scroll at 375 px; XSS payload rendered as literal text, no alert. This caught and I fixed one real bug (a `const` used before declaration in `passenger.js`/`controller.js`). |
| **Not run** | Docker, any deployment, `NODE_ENV=production`, Node 20, Windows, screen readers, cross-browser (Chromium only), load tests. |

## 6. Known issues / caveats
- Anonymous visits log a harmless `401` in the browser console (the nav asks `/api/auth/me`).
- The dataset appears synthetic (R² 0.96; "Medium" congestion has lower mean delay than "Low"); some delays exceed 1,000 min. Do not present the model as predicting real-world delays.
- Logout clears the cookie but does not revoke an already-copied JWT until it expires (8 h); deactivating the user does revoke immediately.
- Socket.io is unauthenticated (it only broadcasts public data).
- Tests drop the `traintrack_test` database.
- `ruff format --check` would reformat 3 Python files (not applied).
- Free-tier hosts may sleep the ML service; first prediction can hit the 10 s timeout (503 with a friendly message).

## 7. Handover: where to continue
**Start here:** `app.js` (wiring), `routes/`, `validation/schemas.js`, `public/js/`, `ai/predict_api.py`, `tests/helpers.js`.

**Run it:** see README.md. Required env: `MONGO_URI`, `JWT_SECRET` (>= 32 chars); for seeding `ADMIN_EMAIL`, `ADMIN_PASSWORD`; optional `ML_SERVICE_URL`, `ML_API_KEY` (must match the ML service's `ML_API_KEY`), `CORS_ORIGIN`, `TRUST_PROXY` (set 1 behind Render/Railway), `ML_TIMEOUT_MS`. Full list in `.env.example`.
**DB:** any MongoDB 6+; Atlas free tier works (allow the host's IP, use the SRV string). Indexes are declared in the models and auto-created.
**ML service:** `cd ai && pip install -r requirements.txt && python predict_api.py` (dev) or `gunicorn predict_api:app` (prod). Model files must sit next to it (or set `MODEL_DIR`).

**Next tasks, in priority order**
1. Run the app once end to end yourself (README steps) and click through all three roles.
2. Add CI (GitHub Actions: Mongo service container, `npm ci && npm run lint && npm test`; Python `pytest`, `ruff`).
3. Deployment: Node web service (build `npm ci`, start `npm start`, `NODE_ENV=production`, `TRUST_PROXY=1`) + Python web service (`gunicorn predict_api:app`) + MongoDB Atlas; set `ML_SERVICE_URL`/`ML_API_KEY`; verify `/health?deep=true`. Add `render.yaml`/Dockerfiles (not written).
4. Add a UI form for creating schedules; paginate the dashboard lists.
5. Convert the manual Playwright script into a CI e2e job.
6. Write `PROJECT_DOCUMENTATION.md`, screenshots, API docs (OpenAPI); replace the dataset with real data if available and re-run `train_model.py`.
7. Decide whether to add `LICENSE` (original had none specified; none was invented).
