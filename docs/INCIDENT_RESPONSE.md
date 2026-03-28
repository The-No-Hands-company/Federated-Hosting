# NexusHosting Incident Response Runbook

Playbooks for common failure scenarios. Each entry covers: how to detect it, immediate mitigation, and root cause investigation.

---

## 1. Node Disk Full

**Symptoms:** Deploys fail with "node storage quota exceeded", site uploads returning 500, MinIO/S3 errors in logs.

**Immediate mitigation:**

```bash
# 1. Check actual disk usage
df -h
docker system df

# 2. Free space fast — clear build cache
rm -rf .build-cache/

# 3. Clear old Docker images/volumes
docker system prune --volumes -f

# 4. Find largest sites
psql $DATABASE_URL -c "SELECT domain, storage_used_mb FROM sites ORDER BY storage_used_mb DESC LIMIT 20;"

# 5. Temporarily suspend the heaviest user if needed
psql $DATABASE_URL -c "UPDATE users SET suspended_at = NOW() WHERE id = '<user-id>';"
```

**Root cause investigation:**

```bash
# Find what's eating space in object storage
# For MinIO:
mc du local/nexus-sites --recursive | sort -k1 -rh | head -20

# Check analytics buffer table (can grow large)
psql $DATABASE_URL -c "SELECT COUNT(*), pg_size_pretty(pg_relation_size('analytics_buffer')) FROM analytics_buffer;"

# Check build artifacts that weren't cleaned up
ls -lah /tmp/nexus-builds-* 2>/dev/null | head -10
```

**Long-term fix:** Increase `STORAGE_CAPACITY_GB`, add a persistent volume, or enable CDN offloading.

---

## 2. Site Reported for Abuse

**Immediate steps:**

1. Log in to the Admin panel at `https://your-node/dashboard`
2. Go to Admin → Moderation
3. Find the report, click **Takedown site** to suspend it immediately
4. The site is now suspended — files remain in storage for evidence

**If the content is CSAM:**

Stop here. Do not investigate the files yourself. Report to:
- **Internet Watch Foundation:** https://report.iwf.org.uk
- **NCMEC CyberTipline:** https://www.missingkids.org/gethelpnow/cybertipline
- **Your local law enforcement**

After reporting externally, run:
```bash
# Permanently delete all files for this site
psql $DATABASE_URL -c "SELECT id, domain FROM sites WHERE domain = 'reported-site.example.com';"
# Use the site ID to remove files from object storage via the admin API
curl -X DELETE https://your-node/api/admin/sites/<id>/files \
  -H "Authorization: Bearer <admin-token>"
```

**Evidence preservation (for other abuse types):**

```bash
# Export site metadata before deletion
psql $DATABASE_URL -c "\COPY (SELECT * FROM sites WHERE domain = 'reported-domain') TO '/tmp/site-evidence.csv' CSV HEADER;"
psql $DATABASE_URL -c "\COPY (SELECT * FROM abuse_reports WHERE site_domain = 'reported-domain') TO '/tmp/report-evidence.csv' CSV HEADER;"
```

---

## 3. Federation Breaks (All Peers Go Offline)

**Symptoms:** Federation page shows all nodes as inactive, sync events failing in logs.

**Diagnosis:**

```bash
# Check what peers the node knows about
psql $DATABASE_URL -c "SELECT domain, status, last_seen_at FROM nodes ORDER BY last_seen_at DESC LIMIT 20;"

# Check if your node can reach peers at all
curl -s https://peer.example.com/.well-known/federation | jq .protocol

# Check federation event log for errors
psql $DATABASE_URL -c "SELECT event_type, from_node_domain, verified, created_at FROM federation_events ORDER BY created_at DESC LIMIT 20;"
```

**Common causes and fixes:**

| Symptom | Cause | Fix |
|---|---|---|
| All pings fail with 401 | Your node's key pair changed | Regenerate via Admin → Settings → Rotate Keys |
| Peers unreachable | Network/firewall issue | Check outbound HTTPS from your server |
| "Stale message" errors | Clock skew | `ntpdate -u pool.ntp.org` to sync time |
| Peers show inactive | Their node went down | Normal — wait for them to come back |

**Reconnect to a specific peer:**

```bash
curl -X POST https://your-node/api/federation/handshake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"targetNodeUrl": "https://peer.example.com"}'
```

---

## 4. Database at 95%+ Capacity

**Symptoms:** Slow queries, `no space left on device` in Postgres logs, failing writes.

**Immediate mitigation:**

```bash
# 1. Find largest tables
psql $DATABASE_URL -c "
  SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 15;"

# 2. Truncate analytics_buffer if it's huge (safe — it's a write buffer, not permanent data)
psql $DATABASE_URL -c "SELECT COUNT(*) FROM analytics_buffer;"
psql $DATABASE_URL -c "TRUNCATE analytics_buffer;"  # ONLY if count is enormous and you accept analytics loss

# 3. Purge old sessions immediately
psql $DATABASE_URL -c "DELETE FROM sessions WHERE expire < NOW();"

# 4. Purge old analytics (beyond retention period)
psql $DATABASE_URL -c "DELETE FROM site_analytics_hourly WHERE hour < NOW() - INTERVAL '90 days';"

# 5. Run VACUUM to reclaim space
psql $DATABASE_URL -c "VACUUM ANALYZE;"
```

**Check retention job is running:**

```bash
# Should see 'retention cleanup' in logs every 6 hours
docker compose logs app --since 12h | grep "retention"
```

---

## 5. Build Pipeline Stuck

**Symptoms:** Build shows "running" in dashboard but never completes, no log output.

**Diagnosis:**

```bash
# Find stuck builds
psql $DATABASE_URL -c "SELECT id, site_id, status, started_at FROM build_jobs WHERE status = 'running' ORDER BY started_at;"

# Check if the build process is actually running
docker compose exec app ps aux | grep node

# Check build logs in DB
psql $DATABASE_URL -c "SELECT log FROM build_jobs WHERE id = <build-id>;"
```

**Fix:**

```bash
# Mark stuck build as failed
psql $DATABASE_URL -c "UPDATE build_jobs SET status = 'failed', finished_at = NOW(), log = log || '\n[manual] Marked failed by operator' WHERE id = <build-id>;"

# If the tmp directory is taking disk space
ls /tmp/nexus-build-* 2>/dev/null
rm -rf /tmp/nexus-build-<build-id>
```

---

## 6. Redis Connection Lost

**Symptoms:** Rate limiting reverts to in-memory (logged as warning), session sharing breaks across instances.

**Immediate impact:**
- Rate limits are per-instance only (effectively N× relaxed)
- Users need to log in again if sessions are Redis-backed
- Cache invalidation won't propagate to the Rust proxy

**Recovery:**

```bash
# Check Redis is running
docker compose ps redis
docker compose restart redis

# Verify connection from app
docker compose exec app node -e "
const Redis = require('ioredis');
const r = new Redis(process.env.REDIS_URL);
r.ping().then(console.log).catch(console.error);
"

# Restart app to re-establish connection
docker compose restart app
```

---

## 7. API Server OOM (Out of Memory Kill)

**Symptoms:** 502 errors, app container repeatedly restarting, `OOMKilled` in `docker inspect`.

**Immediate:**

```bash
# Check if OOM killed
docker inspect $(docker compose ps -q app) | jq '.[].State.OOMKilled'

# Check current memory usage
docker stats --no-stream
```

**Mitigation:**

```bash
# Add memory limit to docker-compose.yml (edit the file):
# services:
#   app:
#     deploy:
#       resources:
#         limits:
#           memory: 1g

# Enable LOW_RESOURCE mode which reduces memory usage
# Add to .env:
LOW_RESOURCE=true
docker compose up -d app
```

**Root cause:** Usually a large analytics flush, large file upload, or a memory leak. Check if it happens at a regular interval (analytics flush is every 60 seconds by default in normal mode).

---

## 8. ACME Certificate Renewal Failure

**Symptoms:** TLS errors after cert expiry, "certificate expired" in browser.

**Check:**

```bash
# Check cert expiry
openssl s_client -connect your-domain.com:443 -servername your-domain.com < /dev/null 2>/dev/null | openssl x509 -noout -dates

# Check ACME logs
docker compose logs app --since 24h | grep -i "acme\|cert\|tls\|renew"

# Check if cert file exists
ls -la $(docker compose exec app sh -c 'echo $ACME_CERT_DIR')/your-domain.com/
```

**Manual renewal trigger:**

```bash
curl -X POST https://your-node/api/tls/renew \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"domain": "your-domain.com"}'
```

**If using Caddy instead of ACME:** Caddy handles renewal automatically — just restart it:

```bash
docker compose restart caddy
```

---

## Emergency Contacts / Escalation

- **Project issues:** https://github.com/The-No-Hands-company/Nexus-Hosting/issues
- **Security vulnerabilities:** Open a private security advisory on GitHub
- **CSAM reports:** https://report.iwf.org.uk and https://www.missingkids.org/gethelpnow/cybertipline (do not delay)
