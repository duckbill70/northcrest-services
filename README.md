# northcrest-services

Back-end APIs for Northcrest Air, a fictional airline used to demonstrate
monitoring on Google Cloud. The platform they run on (projects, Firestore,
the OpenTelemetry pipeline, deploy accounts) lives in
[northcrest-platform](https://github.com/duckbill70/northcrest-platform).

| Service | What it does | Reached at |
| --- | --- | --- |
| `booking-api` | Flight search, fares, seat inventory, bookings and cancellations | `https://<prefix>-booking.web.app/api/...` |
| `flight-status-api` | Departures and arrivals boards, status of a single flight | `https://<prefix>-status.web.app/api/status/...` |

Browsers reach both through Firebase Hosting rewrites in northcrest-web, so
the services need no CORS and their Cloud Run URLs are never advertised.

## How it fits together

- **Schedule.** The daily schedule, fares and the day's delays are pure
  functions of the date (`packages/common/src/schedule.ts`), so both APIs
  agree without sharing a database and the schedule costs no Firestore
  reads. Firestore holds only what people change: bookings, seat counts
  (`inventory/{flightId}`) and operator overrides (`status_overrides`).
- **Telemetry.** Each Cloud Run service runs two containers. The app sends
  OTLP traces to `localhost:4318`; the OpenTelemetry Collector sidecar
  stamps business-unit and tier labels and publishes to the pipeline's
  Pub/Sub topics. The platform's gateway hashes `northcrest.passenger_id`
  (the PNR) before anything is stored, and derives RED metrics from spans,
  so the apps send traces only. Logs are JSON on stdout with trace IDs, so
  Cloud Logging links them to traces.
- **Sidecar config.** `deploy/otel-sidecar.yaml` is a copy of the
  platform's `modules/otel-pipeline/config/sidecar.yaml`. CI fails if the
  two drift apart.

## Working on it

```sh
npm ci
npm run build
npm test
```

Run one API locally without telemetry or Google credentials:

```sh
OTEL_SDK_DISABLED=true node services/flight-status-api/dist/server.js
curl 'localhost:8080/api/status/board?airport=MAN&date=2026-11-26'
```

The booking API needs Firestore; tests use an in-memory store.

## Deploying

Every push to `main` builds both images, pushes them to Artifact Registry
and replaces the Cloud Run services (`deploy/render.py` writes each
service definition). Pull requests run CI only.

### One-time setup

1. **Repository variables** (Settings > Secrets and variables > Actions >
   Variables), from `terraform output passenger` in northcrest-platform's
   `org/`:

   | Variable | From the output |
   | --- | --- |
   | `GCP_WIF_PROVIDER` | `wif_provider` |
   | `GCP_DEPLOY_SA` | `deploy_accounts.services` |
   | `GCP_PROJECT` | `project` |
   | `GCP_REGION` | `region` |
   | `GCP_REGISTRY` | `registry` |
   | `OTEL_PIPELINE_PROJECT` | the project in `otel_topics` (the observability project) |

   The deploy workflow skips itself until `GCP_WIF_PROVIDER` is set.

2. **A `production` environment** (Settings > Environments) whose
   deployment branches are limited to `main`. The deploy account trusts
   only jobs that run in this environment, so a workflow added in a pull
   request can't deploy. A required reviewer is optional.
