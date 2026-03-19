/**
 * Seeds the two bundled sites into the platform on first startup.
 * Idempotent — checks for existing records before inserting.
 */
import { db, sitesTable, siteFilesTable, siteDeploymentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";
import logger from "./logger";

const storage = new ObjectStorageService();

interface BundledFile {
  filePath: string;
  contentType: string;
  content: string;
}

interface BundledSite {
  name: string;
  domain: string;
  description: string;
  files: BundledFile[];
}

async function uploadContent(content: string, contentType: string): Promise<string> {
  const uploadUrl = await storage.getObjectEntityUploadURL();

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: content,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
  return storage.normalizeObjectEntityPath(uploadUrl);
}

async function seedSite(site: BundledSite): Promise<void> {
  const [existing] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.domain, site.domain));

  if (existing) {
    logger.debug({ domain: site.domain }, "[seed] Site already exists, skipping");
    return;
  }

  const [created] = await db
    .insert(sitesTable)
    .values({
      name: site.name,
      domain: site.domain,
      description: site.description,
      ownerId: "system",
      ownerName: "The No Hands Company",
      ownerEmail: "admin@nohands.company",
      status: "active",
    })
    .returning();

  logger.info({ siteId: created.id, domain: site.domain }, "[seed] Site created");

  const fileRecords = await Promise.all(
    site.files.map(async (f) => {
      const objectPath = await uploadContent(f.content, f.contentType);
      const [record] = await db
        .insert(siteFilesTable)
        .values({
          siteId: created.id,
          filePath: f.filePath,
          objectPath,
          contentType: f.contentType,
          sizeBytes: Buffer.byteLength(f.content, "utf8"),
        })
        .returning();
      return record;
    }),
  );

  const totalSizeMb = fileRecords.reduce((acc, f) => acc + f.sizeBytes / (1024 * 1024), 0);

  const [dep] = await db
    .insert(siteDeploymentsTable)
    .values({
      siteId: created.id,
      version: 1,
      deployedBy: "system",
      status: "active",
      fileCount: fileRecords.length,
      totalSizeMb,
    })
    .returning();

  await db
    .update(siteFilesTable)
    .set({ deploymentId: dep.id })
    .where(and(eq(siteFilesTable.siteId, created.id), isNull(siteFilesTable.deploymentId)));

  await db
    .update(sitesTable)
    .set({ storageUsedMb: totalSizeMb })
    .where(eq(sitesTable.id, created.id));

  logger.info(
    { siteId: created.id, domain: site.domain, deploymentId: dep.id },
    "[seed] Site seeded and deployed",
  );
}

export async function seedBundledSites(): Promise<void> {
  try {
    const sites = getBundledSites();
    await Promise.all(sites.map(seedSite));
    logger.info("[seed] Bundled sites seeding complete");
  } catch (err) {
    // Non-fatal — log and continue. The server starts regardless.
    logger.warn({ err }, "[seed] Bundled site seeding failed (non-fatal)");
  }
}

// ─── HTML Content (defined before use in getBundledSites) ─────────────────────

// ─── fedhosting.network ───────────────────────────────────────────────────────

const FEDHOSTING_LANDING = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Federated Hosting — Own Your Corner of the Web</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #0a0a0f;
      --bg2:      #111118;
      --bg3:      #18181f;
      --border:   rgba(255,255,255,0.07);
      --primary:  #00e5ff;
      --primary2: #00bcd4;
      --text:     #e8e8f0;
      --muted:    #6b7280;
      --green:    #22c55e;
      --radius:   14px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Nav ── */
    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(10,10,15,0.85);
      backdrop-filter: blur(12px);
      z-index: 100;
    }
    .logo {
      display: flex; align-items: center; gap: .6rem;
      font-weight: 700; font-size: 1.1rem; color: var(--text);
    }
    .logo-icon {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, var(--primary), var(--primary2));
      display: flex; align-items: center; justify-content: center;
      font-size: .9rem;
    }
    .logo span { color: var(--primary); }
    nav .cta {
      background: var(--primary); color: #000;
      padding: .45rem 1.1rem; border-radius: 8px;
      font-weight: 600; font-size: .875rem;
    }
    nav .cta:hover { background: var(--primary2); text-decoration: none; }

    /* ── Hero ── */
    .hero {
      text-align: center;
      padding: 7rem 2rem 5rem;
      max-width: 800px;
      margin: 0 auto;
    }
    .badge {
      display: inline-flex; align-items: center; gap: .4rem;
      background: rgba(0,229,255,.08);
      border: 1px solid rgba(0,229,255,.2);
      color: var(--primary);
      padding: .3rem .8rem;
      border-radius: 99px;
      font-size: .8rem;
      font-weight: 500;
      margin-bottom: 2rem;
    }
    .badge::before { content: "●"; font-size: .5rem; }
    h1 {
      font-size: clamp(2.5rem, 6vw, 4.2rem);
      font-weight: 800;
      letter-spacing: -.03em;
      line-height: 1.1;
      margin-bottom: 1.5rem;
      background: linear-gradient(135deg, #ffffff 40%, var(--primary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      font-size: 1.2rem;
      color: var(--muted);
      max-width: 580px;
      margin: 0 auto 2.5rem;
    }
    .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-flex; align-items: center; gap: .5rem;
      padding: .75rem 1.75rem;
      border-radius: 10px;
      font-weight: 600; font-size: 1rem;
      cursor: pointer;
      transition: all .15s;
    }
    .btn-primary {
      background: var(--primary); color: #000;
      box-shadow: 0 0 24px rgba(0,229,255,.3);
    }
    .btn-primary:hover { background: var(--primary2); text-decoration: none; transform: translateY(-1px); }
    .btn-ghost {
      border: 1px solid var(--border);
      color: var(--text);
      background: transparent;
    }
    .btn-ghost:hover { border-color: rgba(255,255,255,.2); text-decoration: none; }

    /* ── Stats ── */
    .stats {
      display: flex;
      justify-content: center;
      gap: 3rem;
      padding: 3rem 2rem;
      background: var(--bg2);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .stat { text-align: center; }
    .stat-value {
      font-size: 2rem; font-weight: 800;
      color: var(--primary); font-variant-numeric: tabular-nums;
    }
    .stat-label { font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }

    /* ── How it works ── */
    section { padding: 5rem 2rem; max-width: 1100px; margin: 0 auto; }
    h2 {
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      font-weight: 700;
      text-align: center;
      margin-bottom: .75rem;
    }
    .section-sub { color: var(--muted); text-align: center; margin-bottom: 3.5rem; font-size: 1.05rem; }

    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
    }
    .step {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      position: relative;
    }
    .step-num {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: rgba(0,229,255,.1);
      border: 1px solid rgba(0,229,255,.25);
      color: var(--primary);
      font-weight: 700;
      font-size: .9rem;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 1rem;
    }
    .step h3 { font-size: 1rem; font-weight: 600; margin-bottom: .5rem; }
    .step p { font-size: .875rem; color: var(--muted); }

    /* ── Features ── */
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.25rem;
    }
    .feature {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      transition: border-color .2s;
    }
    .feature:hover { border-color: rgba(0,229,255,.2); }
    .feature-icon {
      font-size: 1.5rem; margin-bottom: .75rem; display: block;
    }
    .feature h3 { font-size: 1rem; font-weight: 600; margin-bottom: .5rem; }
    .feature p { font-size: .875rem; color: var(--muted); }

    /* ── CTA Banner ── */
    .cta-banner {
      background: linear-gradient(135deg, rgba(0,229,255,.06), rgba(0,188,212,.03));
      border: 1px solid rgba(0,229,255,.12);
      border-radius: 20px;
      padding: 4rem 2rem;
      text-align: center;
      margin: 2rem auto 5rem;
      max-width: 700px;
    }
    .cta-banner h2 { margin-bottom: 1rem; }
    .cta-banner p { color: var(--muted); margin-bottom: 2rem; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      font-size: .85rem;
    }
    footer .footer-links { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: .75rem; flex-wrap: wrap; }

    /* ── Node indicator ── */
    .node-tag {
      display: inline-flex; align-items: center; gap: .4rem;
      background: rgba(34,197,94,.07);
      border: 1px solid rgba(34,197,94,.2);
      color: var(--green);
      padding: .2rem .65rem;
      border-radius: 99px;
      font-size: .75rem;
      font-family: monospace;
    }
    .node-tag::before { content: "●"; font-size: .4rem; }
  </style>
</head>
<body>

<nav>
  <div class="logo">
    <div class="logo-icon">⚡</div>
    <span>Federated <span>Hosting</span></span>
  </div>
  <div style="display:flex;align-items:center;gap:1rem;">
    <span class="node-tag">node online</span>
    <a href="/api/sites/serve/fedhosting.network/" class="cta">Launch App</a>
  </div>
</nav>

<div class="hero">
  <div class="badge">Open-Source · Federated · Cryptographically Verified</div>
  <h1>Own Your Corner<br />of the Web</h1>
  <p class="subtitle">
    Federated Hosting is an open-source network where independent nodes
    cooperate to host websites — no central authority, no single point of failure.
  </p>
  <div class="hero-actions">
    <a href="#how" class="btn btn-primary">⚡ Get Started</a>
    <a href="https://github.com/The-No-Hands-company/Federated-Hosting" class="btn btn-ghost" target="_blank">
      ★ View on GitHub
    </a>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-value" id="nodeCount">—</div>
    <div class="stat-label">Active Nodes</div>
  </div>
  <div class="stat">
    <div class="stat-value" id="siteCount">—</div>
    <div class="stat-label">Hosted Sites</div>
  </div>
  <div class="stat">
    <div class="stat-value">Ed25519</div>
    <div class="stat-label">Cryptographic Trust</div>
  </div>
  <div class="stat">
    <div class="stat-value">fedhost/1.0</div>
    <div class="stat-label">Protocol Version</div>
  </div>
</div>

<section id="how">
  <h2>Deploy in three steps</h2>
  <p class="section-sub">No servers to manage. No lock-in. Your files live on the network.</p>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <h3>Sign In</h3>
      <p>Use your Replit account to authenticate. Your identity is linked to your node.</p>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <h3>Upload Files</h3>
      <p>Drag-and-drop your HTML, CSS, JS, and images into the deploy panel.</p>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <h3>Hit Deploy</h3>
      <p>Your site goes live instantly and is replicated across peer nodes automatically.</p>
    </div>
  </div>
</section>

<section>
  <h2>Built different</h2>
  <p class="section-sub">Not another centralised host. A cryptographically verified mesh of independent nodes.</p>
  <div class="features">
    <div class="feature">
      <span class="feature-icon">🔑</span>
      <h3>Ed25519 Identity</h3>
      <p>Every node generates an asymmetric key pair. Handshakes are signed and verifiable — no impersonation possible.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">🌐</span>
      <h3>Federated by Design</h3>
      <p>Nodes discover each other via <code>/.well-known/federation</code>, exchange signed pings, and sync site data peer-to-peer.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">⚙️</span>
      <h3>Run Your Own Node</h3>
      <p>Self-host the platform on any server. Your node, your rules. Nodes can join or leave the network at any time.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">📡</span>
      <h3>Auto Replication</h3>
      <p>When you deploy a site, active peers are notified and can mirror the content — surviving single-node outages.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">💓</span>
      <h3>Live Health Monitoring</h3>
      <p>Nodes ping each other every 2 minutes. The dashboard shows real-time network health — offline nodes flagged instantly.</p>
    </div>
    <div class="feature">
      <span class="feature-icon">🛡️</span>
      <h3>Open Protocol</h3>
      <p>The <code>fedhost/1.0</code> spec is language-agnostic and fully documented. Build your own node in any language.</p>
    </div>
  </div>
</section>

<div class="cta-banner">
  <h2>Ready to join the network?</h2>
  <p>Sign in, register a domain, and deploy your first site in under two minutes.</p>
  <a href="#" class="btn btn-primary">⚡ Start Hosting Free</a>
</div>

<footer>
  <div class="footer-links">
    <a href="https://github.com/The-No-Hands-company/Federated-Hosting">GitHub</a>
    <a href="/api/federation/meta">Node Metadata</a>
    <a href="/.well-known/federation">Discovery</a>
    <a href="https://github.com/The-No-Hands-company/Federated-Hosting/blob/main/FEDERATION.md">Protocol Spec</a>
  </div>
  <p>Built with ❤ by <a href="/api/sites/serve/nohands.company/">The No Hands Company</a> · Open-source under MIT</p>
</footer>

<script>
  // Pull live node stats from the local federation endpoint
  fetch('/api/federation/meta')
    .then(r => r.json())
    .then(d => {
      document.getElementById('nodeCount').textContent = d.nodeCount ?? '—';
      document.getElementById('siteCount').textContent = d.activeSites ?? '—';
    })
    .catch(() => {});
</script>
</body>
</html>`;

// ─── nohands.company ──────────────────────────────────────────────────────────

const NOHANDS_COMPANY = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The No Hands Company</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:      #080810;
      --bg2:     #0f0f18;
      --border:  rgba(255,255,255,0.06);
      --accent:  #7c3aed;
      --accent2: #a855f7;
      --text:    #e2e2f0;
      --muted:   #64748b;
      --radius:  12px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    a { color: var(--accent2); text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0;
      background: rgba(8,8,16,.9);
      backdrop-filter: blur(12px);
    }
    .logo {
      font-weight: 800; font-size: 1.05rem;
      background: linear-gradient(135deg, var(--accent2), #ec4899);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    nav a { font-size: .875rem; color: var(--muted); }
    nav a:hover { color: var(--text); text-decoration: none; }
    .nav-links { display: flex; gap: 1.75rem; align-items: center; }

    .hero {
      max-width: 720px; margin: 0 auto;
      padding: 8rem 2rem 6rem;
      text-align: center;
    }
    .hero-kicker {
      font-size: .8rem; text-transform: uppercase; letter-spacing: .1em;
      color: var(--accent2); margin-bottom: 1.5rem; font-weight: 600;
    }
    h1 {
      font-size: clamp(2.8rem, 7vw, 4.5rem);
      font-weight: 900;
      letter-spacing: -.04em;
      line-height: 1.05;
      margin-bottom: 1.5rem;
    }
    h1 em { font-style: normal; color: var(--accent2); }
    .hero p { color: var(--muted); font-size: 1.1rem; max-width: 520px; margin: 0 auto 2.5rem; }
    .hero-pill {
      display: inline-block;
      background: rgba(124,58,237,.1);
      border: 1px solid rgba(124,58,237,.25);
      color: var(--accent2);
      padding: .4rem 1rem;
      border-radius: 99px;
      font-size: .85rem;
      font-weight: 500;
    }

    section { padding: 4rem 2rem; max-width: 1000px; margin: 0 auto; }
    h2 { font-size: 1.75rem; font-weight: 700; margin-bottom: .5rem; }
    .section-sub { color: var(--muted); margin-bottom: 2.5rem; }

    .projects {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .project {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      transition: border-color .2s, transform .2s;
    }
    .project:hover { border-color: rgba(124,58,237,.35); transform: translateY(-2px); }
    .project-tag {
      font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
      color: var(--accent2); font-weight: 600; margin-bottom: .75rem;
    }
    .project h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: .5rem; }
    .project p { font-size: .875rem; color: var(--muted); margin-bottom: 1.25rem; }
    .project a {
      font-size: .85rem; font-weight: 600; color: var(--accent2);
      display: inline-flex; align-items: center; gap: .3rem;
    }

    .values {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .value {
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.5rem;
      text-align: center;
    }
    .value-icon { font-size: 2rem; margin-bottom: .75rem; display: block; }
    .value h3 { font-size: .95rem; font-weight: 600; margin-bottom: .35rem; }
    .value p { font-size: .8rem; color: var(--muted); }

    footer {
      border-top: 1px solid var(--border);
      padding: 2rem; text-align: center;
      color: var(--muted); font-size: .85rem;
    }
    .footer-links { display: flex; gap: 1.5rem; justify-content: center; margin-bottom: .75rem; flex-wrap: wrap; }
    .footer-links a { color: var(--muted); font-size: .85rem; }
    .footer-links a:hover { color: var(--text); }
  </style>
</head>
<body>

<nav>
  <div class="logo">The No Hands Company</div>
  <div class="nav-links">
    <a href="#projects">Projects</a>
    <a href="#values">Values</a>
    <a href="https://github.com/The-No-Hands-company" target="_blank">GitHub</a>
  </div>
</nav>

<div class="hero">
  <p class="hero-kicker">Open-source software studio</p>
  <h1>We build things that<br /><em>matter</em></h1>
  <p>A small studio focused on open-source infrastructure, federated networks, and tools for everyday creators.</p>
  <span class="hero-pill">🌍 Building for the open web</span>
</div>

<section id="projects">
  <h2>Projects</h2>
  <p class="section-sub">What we're working on right now.</p>
  <div class="projects">
    <div class="project">
      <div class="project-tag">Infrastructure · Open Source</div>
      <h3>⚡ Federated Hosting</h3>
      <p>A cryptographically verified mesh network for hosting websites without centralised control. Independent nodes cooperate using the <code>fedhost/1.0</code> protocol.</p>
      <a href="https://github.com/The-No-Hands-company/Federated-Hosting" target="_blank">View on GitHub →</a>
    </div>
    <div class="project">
      <div class="project-tag">Protocol · Specification</div>
      <h3>📡 fedhost Protocol</h3>
      <p>The open, language-agnostic specification powering Federated Hosting. Ed25519 signed handshakes, site sync events, and a standard discovery format.</p>
      <a href="https://github.com/The-No-Hands-company/Federated-Hosting/blob/main/FEDERATION.md" target="_blank">Read the spec →</a>
    </div>
    <div class="project">
      <div class="project-tag">Coming Soon</div>
      <h3>🔧 More to come</h3>
      <p>We're a small team with a big backlog. Watch the GitHub organisation for new projects dropping throughout 2026.</p>
      <a href="https://github.com/The-No-Hands-company" target="_blank">Follow us →</a>
    </div>
  </div>
</section>

<section id="values">
  <h2>What we stand for</h2>
  <p class="section-sub">The principles behind everything we build.</p>
  <div class="values">
    <div class="value">
      <span class="value-icon">🌐</span>
      <h3>Open Web</h3>
      <p>The web belongs to everyone. We build infrastructure that resists centralisation.</p>
    </div>
    <div class="value">
      <span class="value-icon">🔓</span>
      <h3>Open Source</h3>
      <p>Everything we make is MIT-licensed. Fork it, learn from it, build on it.</p>
    </div>
    <div class="value">
      <span class="value-icon">🌍</span>
      <h3>Global First</h3>
      <p>We build for creators everywhere — with a focus on underserved communities.</p>
    </div>
    <div class="value">
      <span class="value-icon">🛠️</span>
      <h3>Useful Tools</h3>
      <p>We ship things that solve real problems for real people, not demos.</p>
    </div>
  </div>
</section>

<footer>
  <div class="footer-links">
    <a href="https://github.com/The-No-Hands-company">GitHub</a>
    <a href="/api/sites/serve/fedhosting.network/">Federated Hosting</a>
  </div>
  <p>The No Hands Company · Open source with ❤</p>
</footer>

</body>
</html>`;

// ─── Site registry (after HTML constants are initialized) ─────────────────────

function getBundledSites(): BundledSite[] {
  return [
    {
      name: "Federated Hosting — Home",
      domain: "fedhosting.network",
      description: "Official home page for the Federated Hosting open-source project.",
      files: [{ filePath: "index.html", contentType: "text/html", content: FEDHOSTING_LANDING }],
    },
    {
      name: "The No Hands Company",
      domain: "nohands.company",
      description: "Portfolio and home page for The No Hands Company.",
      files: [{ filePath: "index.html", contentType: "text/html", content: NOHANDS_COMPANY }],
    },
  ];
}
