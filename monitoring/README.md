# NexusHosting Monitoring Stack

Grafana + Prometheus configuration for observing NexusHosting nodes.

## Quick start (add to your docker-compose.yml)

```yaml
services:
  prometheus:
    image: prom/prometheus:v2.51.0
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:10.4.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_PASSWORD:-admin}"
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/datasources.yaml:/etc/grafana/provisioning/datasources/nexushosting.yaml:ro
      - ./monitoring/grafana/dashboards.yaml:/etc/grafana/provisioning/dashboards/nexushosting.yaml:ro
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
    ports:
      - "3001:3000"

volumes:
  prometheus_data:
  grafana_data:
```

## Prometheus scrape config (`monitoring/prometheus.yml`)

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: nexus
    static_configs:
      - targets: ['app:8080']
    metrics_path: /metrics
    # If METRICS_TOKEN is set, add:
    # bearer_token: your-metrics-token
```

## Dashboards

| Dashboard | UID | Description |
|---|---|---|
| Node Overview | `nexus-node` | HTTP rate, latency percentiles, memory, DB pool, deploys |
| Federation Health | `nexus-federation` | Peers, sync rate, signature verifications, retry queue |
| Site Traffic | `nexus-traffic` | Per-site hits, bandwidth, cache rate, top-N charts |

## Accessing Grafana

After `docker-compose up`, open http://localhost:3001

Default credentials: `admin` / value of `GRAFANA_PASSWORD` env var (default: `admin`)

## Available metrics (from `/metrics` endpoint)

The NexusHosting API server exposes Prometheus metrics via `prom-client`. Key metrics:

- `nexus_http_requests_total{method,status,route}` — HTTP request counter
- `nexus_http_request_duration_seconds` — Latency histogram
- `nexus_deployments_total{status}` — Deploy counter
- `nexus_active_sites_total` — Active site gauge
- `nexus_federation_peers_total{status}` — Peer count by status
- `nexus_federation_events_total{type}` — Federation event counter
- `nexus_federation_syncs_total{result}` — Sync success/failure
- `nexus_signature_verifications_total{result}` — Ed25519 verify counter
- `nexus_site_hits_total{site_domain}` — Per-site hit counter
- `nexus_bytes_served_total{site_domain}` — Per-site bytes served
- `nexus_db_pool_connections_active/idle` — DB pool state
- `nexus_cache_hits_total` / `nexus_cache_misses_total` — LRU cache
- `nexus_sync_retry_queue_depth` — Outstanding federation retries
- Standard Node.js metrics (heap, GC, event loop lag, libuv handles)

Set `METRICS_TOKEN` env var to require bearer auth on the `/metrics` endpoint.
