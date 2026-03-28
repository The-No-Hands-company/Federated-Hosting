import { eq } from "drizzle-orm";
import { db, nodesTable, sitesTable } from "@workspace/db";

async function seed() {
  const existingNodes = await db.select().from(nodesTable);
  if (existingNodes.length > 0) {
    console.log("Data already seeded, skipping.");
    process.exit(0);
  }

  console.log("Seeding federation data...");

  const nodes = await db
    .insert(nodesTable)
    .values([
      {
        name: "Nova Node",
        domain: "nova.fed-host.net",
        description: "High-performance node based in Frankfurt. Specializes in static site hosting with global CDN integration.",
        status: "active",
        region: "EU-West",
        operatorName: "Lena Braun",
        operatorEmail: "lena@nova-node.eu",
        storageCapacityGb: 500,
        bandwidthCapacityGb: 2000,
        uptimePercent: 99.87,
        siteCount: 0,
        publicKey: "ed25519:NOVAXYZ8k2mLpQrT9wAbCdEfGhJkMnOpRsTuVwXyZ",
        lastSeenAt: new Date(),
      },
      {
        name: "Atlas Node",
        domain: "atlas.nexushosting.io",
        description: "Community-run node in North America. Supports both static and dynamic sites with PostgreSQL backends.",
        status: "active",
        region: "NA-East",
        operatorName: "Marcus Chen",
        operatorEmail: "marcus@atlas-node.io",
        storageCapacityGb: 1000,
        bandwidthCapacityGb: 5000,
        uptimePercent: 99.92,
        siteCount: 0,
        publicKey: "ed25519:ATLASABC7n3pKqUs0vByCdFgHiLmNpQrTvWxYz",
        lastSeenAt: new Date(),
      },
      {
        name: "Meridian Hub",
        domain: "meridian.selfhost.sh",
        description: "Singapore-based node with low-latency Asia-Pacific routing and solar-powered infrastructure.",
        status: "active",
        region: "APAC",
        operatorName: "Priya Sharma",
        operatorEmail: "priya@meridian.sh",
        storageCapacityGb: 300,
        bandwidthCapacityGb: 1000,
        uptimePercent: 98.76,
        siteCount: 0,
        publicKey: "ed25519:MERIDANPQ4r5StUvWxYzAbCdEfGhJkLmNoQrTu",
        lastSeenAt: new Date(Date.now() - 5 * 60 * 1000),
      },
      {
        name: "Boreal Relay",
        domain: "boreal.openhost.ca",
        description: "Canadian node focusing on privacy-first hosting with no tracking or analytics.",
        status: "maintenance",
        region: "NA-West",
        operatorName: "James O'Connor",
        operatorEmail: "james@openhost.ca",
        storageCapacityGb: 200,
        bandwidthCapacityGb: 800,
        uptimePercent: 97.5,
        siteCount: 0,
        publicKey: null,
        lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        name: "Vortex Node",
        domain: "vortex.nethost.eu",
        description: "Dutch node with high bandwidth allocation for media-rich sites.",
        status: "inactive",
        region: "EU-North",
        operatorName: "Erik van Dam",
        operatorEmail: "erik@nethost.eu",
        storageCapacityGb: 150,
        bandwidthCapacityGb: 600,
        uptimePercent: 85.4,
        siteCount: 0,
        publicKey: "ed25519:VORTEXRS6t7UvWxYzAbCdEfGhJkLmNoQrStUvW",
        lastSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ])
    .returning();

  console.log(`Inserted ${nodes.length} nodes`);

  const sites = await db
    .insert(sitesTable)
    .values([
      {
        name: "Open Source Collective",
        domain: "oss-collective.net",
        description: "A community hub for open source contributors. News, jobs, and project announcements.",
        status: "active",
        siteType: "blog",
        ownerName: "Community Team",
        ownerEmail: "admin@oss-collective.net",
        primaryNodeId: nodes[0].id,
        replicaCount: 3,
        storageUsedMb: 240,
        monthlyBandwidthGb: 45,
      },
      {
        name: "Libre Docs",
        domain: "libredocs.org",
        description: "Free, community-curated documentation for open source projects.",
        status: "active",
        siteType: "static",
        ownerName: "Sam Rivera",
        ownerEmail: "sam@libredocs.org",
        primaryNodeId: nodes[1].id,
        replicaCount: 4,
        storageUsedMb: 890,
        monthlyBandwidthGb: 120,
      },
      {
        name: "Fedi Artist Portfolio",
        domain: "ana-art.gallery",
        description: "Digital art portfolio with high-resolution image hosting distributed across the federation.",
        status: "active",
        siteType: "portfolio",
        ownerName: "Ana Kowalski",
        ownerEmail: "ana@ana-art.gallery",
        primaryNodeId: nodes[2].id,
        replicaCount: 2,
        storageUsedMb: 4200,
        monthlyBandwidthGb: 18,
      },
      {
        name: "Privacy Weekly",
        domain: "privacyweekly.xyz",
        description: "Weekly newsletter and blog covering digital privacy, security, and decentralized tech.",
        status: "active",
        siteType: "blog",
        ownerName: "Dev Anand",
        ownerEmail: "dev@privacyweekly.xyz",
        primaryNodeId: nodes[0].id,
        replicaCount: 3,
        storageUsedMb: 125,
        monthlyBandwidthGb: 32,
      },
      {
        name: "Node Status Monitor",
        domain: "status.nexushosting.io",
        description: "Real-time status monitoring dashboard for federation nodes.",
        status: "active",
        siteType: "dynamic",
        ownerName: "Marcus Chen",
        ownerEmail: "marcus@atlas-node.io",
        primaryNodeId: nodes[1].id,
        replicaCount: 2,
        storageUsedMb: 50,
        monthlyBandwidthGb: 8,
      },
      {
        name: "Decentralized Radio",
        domain: "decradio.fm",
        description: "Community internet radio streaming through the federated hosting network.",
        status: "migrating",
        siteType: "dynamic",
        ownerName: "Radio Collective",
        ownerEmail: "ops@decradio.fm",
        primaryNodeId: nodes[2].id,
        replicaCount: 1,
        storageUsedMb: 15000,
        monthlyBandwidthGb: 850,
      },
      {
        name: "Green Tech Blog",
        domain: "greentech.earth",
        description: "Articles about sustainable technology and eco-friendly computing practices.",
        status: "suspended",
        siteType: "blog",
        ownerName: "Mia Jensen",
        ownerEmail: "mia@greentech.earth",
        primaryNodeId: null,
        replicaCount: 0,
        storageUsedMb: 85,
        monthlyBandwidthGb: 0,
      },
    ])
    .returning();

  console.log(`Inserted ${sites.length} sites`);

  for (const node of nodes) {
    const siteCount = sites.filter((s) => s.primaryNodeId === node.id).length;
    await db
      .update(nodesTable)
      .set({ siteCount })
      .where(eq(nodesTable.id, node.id));
  }

  console.log("Site counts updated. Seeding complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
