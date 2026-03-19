// Mobile menu toggle
function toggleMenu() {
  const m = document.getElementById("mobileMenu");
  m.classList.toggle("open");
}

// Animated counters
function animateCounters() {
  document.querySelectorAll(".stat-num").forEach((el) => {
    const target = parseFloat(el.dataset.target);
    const isDecimal = target % 1 !== 0;
    const duration = 1800;
    const start = performance.now();
    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = eased * target;
      el.textContent = isDecimal ? value.toFixed(1) : Math.floor(value).toString();
      if (progress < 1) requestAnimationFrame(update);
      else el.textContent = isDecimal ? target.toFixed(1) : target.toString();
    }
    requestAnimationFrame(update);
  });
}

const heroObserver = new IntersectionObserver(
  (entries) => { if (entries[0].isIntersecting) { animateCounters(); heroObserver.disconnect(); } },
  { threshold: 0.3 }
);
const heroStats = document.querySelector(".hero-stats");
if (heroStats) heroObserver.observe(heroStats);

// Fetch live node / site counts from the API
async function fetchLiveStats() {
  try {
    const [nodesRes, sitesRes] = await Promise.all([
      fetch("/api/nodes?limit=1"),
      fetch("/api/sites?limit=1"),
    ]);
    if (nodesRes.ok) {
      const data = await nodesRes.json();
      const el = document.getElementById("liveNodes");
      if (el && data.meta?.total) el.textContent = data.meta.total;
    }
    if (sitesRes.ok) {
      const data = await sitesRes.json();
      const el = document.getElementById("liveSites");
      if (el && data.meta?.total !== undefined) el.textContent = data.meta.total;
    }
  } catch {
    // silently ignore — static fallback values remain
  }
}
fetchLiveStats();

// Network canvas animation
const canvas = document.getElementById("networkCanvas");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const W = 800, H = 400;

  const nodes = [
    { x: 0.15, y: 0.25, label: "EU-West" },
    { x: 0.38, y: 0.18, label: "EU-North" },
    { x: 0.55, y: 0.35, label: "US-East" },
    { x: 0.72, y: 0.22, label: "US-West" },
    { x: 0.85, y: 0.55, label: "Asia" },
    { x: 0.62, y: 0.65, label: "AU" },
    { x: 0.28, y: 0.7, label: "SA" },
    { x: 0.45, y: 0.52, label: "Central" },
  ].map((n) => ({ ...n, px: n.x * W, py: n.y * H, r: 6, pulse: Math.random() * Math.PI * 2 }));

  const edges = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,7],[7,6],[6,0],[1,7],[2,7],[3,5],[0,7]
  ];

  // Travelling packets
  const packets = [];
  function spawnPacket() {
    const edgeIdx = Math.floor(Math.random() * edges.length);
    const [a, b] = edges[edgeIdx];
    const rev = Math.random() < 0.5;
    packets.push({ from: rev ? b : a, to: rev ? a : b, t: 0, speed: 0.004 + Math.random() * 0.004 });
  }
  for (let i = 0; i < 5; i++) spawnPacket();

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, W, H);

    // Edges
    edges.forEach(([a, b]) => {
      const na = nodes[a], nb = nodes[b];
      ctx.beginPath();
      ctx.moveTo(na.px, na.py);
      ctx.lineTo(nb.px, nb.py);
      ctx.strokeStyle = "rgba(108,111,255,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Packets
    packets.forEach((p, i) => {
      p.t += p.speed;
      if (p.t >= 1) {
        packets.splice(i, 1);
        spawnPacket();
        return;
      }
      const na = nodes[p.from], nb = nodes[p.to];
      const x = na.px + (nb.px - na.px) * p.t;
      const y = na.py + (nb.py - na.py) * p.t;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#a78bfa";
      ctx.fill();
    });

    // Nodes
    const t = ts / 1000;
    nodes.forEach((n) => {
      n.pulse += 0.04;
      const pulseR = n.r + 3 + Math.sin(n.pulse) * 2;

      // Outer glow
      const grad = ctx.createRadialGradient(n.px, n.py, n.r, n.px, n.py, pulseR + 8);
      grad.addColorStop(0, "rgba(108,111,255,0.4)");
      grad.addColorStop(1, "rgba(108,111,255,0)");
      ctx.beginPath();
      ctx.arc(n.px, n.py, pulseR + 8, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(n.px, n.py, n.r, 0, Math.PI * 2);
      ctx.fillStyle = "#6c6fff";
      ctx.fill();
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      ctx.fillStyle = "rgba(232,234,240,0.7)";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(n.label, n.px, n.py + n.r + 14);
    });

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
});
