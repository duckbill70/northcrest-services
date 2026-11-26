#!/usr/bin/env python3
"""Render the Cloud Run service definition for one API.

Each service runs two containers: the app, and the OpenTelemetry Collector
as a sidecar that receives OTLP on localhost and publishes to the pipeline's
Pub/Sub topics. Output is JSON, which `gcloud run services replace` reads as
YAML.

  python3 deploy/render.py booking-api IMAGE > service.json

Reads GCP_PROJECT and OTEL_PIPELINE_PROJECT from the environment.
"""

import json
import os
import pathlib
import sys

COLLECTOR_IMAGE = (
    "us-docker.pkg.dev/cloud-ops-agents-artifacts/"
    "google-cloud-opentelemetry-collector/otelcol-google:0.165.2-r.1"
)

# Per service: business unit and risk tier labels the sidecar stamps on
# every span, and how far it may scale. Max instances keep a runaway load
# test inside the free tier.
SERVICES = {
    "booking-api": {"unit": "customer-channels", "tier": "commercial", "max": 3},
    "flight-status-api": {"unit": "customer-channels", "tier": "commercial", "max": 3},
}


def render(service: str, image: str) -> dict:
    spec = SERVICES[service]
    project = os.environ["GCP_PROJECT"]
    pipeline = os.environ["OTEL_PIPELINE_PROJECT"]
    sidecar = (pathlib.Path(__file__).parent / "otel-sidecar.yaml").read_text()

    return {
        "apiVersion": "serving.knative.dev/v1",
        "kind": "Service",
        "metadata": {
            "name": service,
            "labels": {
                "business-unit": spec["unit"],
                "tier": spec["tier"],
                "managed-by": "northcrest-services",
            },
            "annotations": {
                # Public through Firebase Hosting rewrites. The org forbids
                # allUsers, so the invoker check is off instead.
                "run.googleapis.com/invoker-iam-disabled": "true",
                "run.googleapis.com/ingress": "all",
            },
        },
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "autoscaling.knative.dev/minScale": "0",
                        "autoscaling.knative.dev/maxScale": str(spec["max"]),
                        # Request-based billing: CPU only while serving.
                        "run.googleapis.com/cpu-throttling": "true",
                        "run.googleapis.com/startup-cpu-boost": "true",
                        # Start the collector first so no early span is lost.
                        "run.googleapis.com/container-dependencies": json.dumps({"app": ["otel-collector"]}),
                    }
                },
                "spec": {
                    "serviceAccountName": f"{service}@{project}.iam.gserviceaccount.com",
                    "containerConcurrency": 80,
                    "timeoutSeconds": 30,
                    "containers": [
                        {
                            "name": "app",
                            "image": image,
                            "ports": [{"name": "http1", "containerPort": 8080}],
                            "env": [
                                {"name": "OTEL_SERVICE_NAME", "value": f"northcrest-{service}"},
                                {"name": "OTEL_EXPORTER_OTLP_ENDPOINT", "value": "http://localhost:4318"},
                                {"name": "OTEL_PIPELINE_PROJECT", "value": pipeline},
                                {"name": "GOOGLE_CLOUD_PROJECT", "value": project},
                            ],
                            "resources": {"limits": {"cpu": "1", "memory": "512Mi"}},
                            "startupProbe": {
                                "httpGet": {"path": "/healthz", "port": 8080},
                                "periodSeconds": 2,
                                "failureThreshold": 15,
                            },
                        },
                        {
                            "name": "otel-collector",
                            "image": COLLECTOR_IMAGE,
                            "args": ["--config=env:OTELCOL_CONFIG"],
                            "env": [
                                {"name": "OTELCOL_CONFIG", "value": sidecar},
                                {"name": "OTEL_PIPELINE_PROJECT", "value": pipeline},
                                {"name": "NORTHCREST_BUSINESS_UNIT", "value": spec["unit"]},
                                {"name": "NORTHCREST_TIER", "value": spec["tier"]},
                            ],
                            "resources": {"limits": {"cpu": "1", "memory": "256Mi"}},
                            "startupProbe": {
                                "httpGet": {"path": "/", "port": 13133},
                                "periodSeconds": 2,
                                "failureThreshold": 15,
                            },
                        },
                    ],
                },
            },
            "traffic": [{"percent": 100, "latestRevision": True}],
        },
    }


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in SERVICES:
        sys.exit(f"usage: render.py {{{','.join(SERVICES)}}} IMAGE")
    json.dump(render(sys.argv[1], sys.argv[2]), sys.stdout, indent=2)
    print()
