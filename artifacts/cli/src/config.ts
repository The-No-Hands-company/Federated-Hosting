import Conf from "conf";

export interface FhConfig {
  nodeUrl: string;
  token: string;
  tokenName: string;
}

const store = new Conf<Partial<FhConfig>>({
  projectName: "nexus-cli",
  schema: {
    nodeUrl:   { type: "string" },
    token:     { type: "string" },
    tokenName: { type: "string" },
  },
});

export function getConfig(): Partial<FhConfig> {
  return {
    nodeUrl:   store.get("nodeUrl"),
    token:     store.get("token"),
    tokenName: store.get("tokenName"),
  };
}

export function saveConfig(updates: Partial<FhConfig>): void {
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) store.set(k as keyof FhConfig, v);
  }
}

export function clearConfig(): void {
  store.clear();
}

export function requireAuth(): { nodeUrl: string; token: string } {
  const cfg = getConfig();
  if (!cfg.nodeUrl || !cfg.token) {
    console.error(
      "Not logged in. Run:  nh login --node https://your-node.example.com",
    );
    process.exit(1);
  }
  return { nodeUrl: cfg.nodeUrl, token: cfg.token };
}
