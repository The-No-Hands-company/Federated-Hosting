import { describe, it, expect } from "vitest";
import {
  buildSystemsApiRegistrationPayload,
  type SystemsApiRegistrationPayload,
} from "../../src/nexusHostingContracts";

describe("nexus-hosting MVP contracts", () => {
  it("registration payload shape is stable", () => {
    const payload = buildSystemsApiRegistrationPayload("http://localhost:8080");

    expect(payload.id).toBe("nexus-hosting");
    expect(payload.mode).toBe("standalone");
    expect(payload.exposed).toBe(true);
    expect(Array.isArray(payload.capabilities)).toBe(true);
    expect(typeof payload.metadata).toBe("object");
  });

  it("upstreamUrl is forwarded correctly", () => {
    const url = "https://hosting.nexus.example.com";
    const payload = buildSystemsApiRegistrationPayload(url);
    expect(payload.upstreamUrl).toBe(url);
  });

  it("full capabilities list is complete", () => {
    const payload = buildSystemsApiRegistrationPayload("http://localhost:8080");
    const expected = [
      "federated-site-hosting",
      "custom-domain-management",
      "acme-tls-provisioning",
      "object-storage-proxy",
      "gossip-federation",
      "site-health-monitoring",
      "analytics-flusher",
      "webhook-delivery",
    ];
    for (const cap of expected) {
      expect(payload.capabilities).toContain(cap);
    }
  });

  it("metadata fields are all present", () => {
    const { metadata } = buildSystemsApiRegistrationPayload("http://localhost:8080");
    expect(metadata["hostingVersion"]).toBe("v1");
    expect(metadata["supportsFederatedHosting"]).toBe(true);
    expect(metadata["supportsCustomDomains"]).toBe(true);
    expect(metadata["supportsAcmeTls"]).toBe(true);
    expect(metadata["supportsObjectStorage"]).toBe(true);
    expect(metadata["supportsGossipFederation"]).toBe(true);
  });

  it("satisfies SystemsApiRegistrationPayload type", () => {
    const payload: SystemsApiRegistrationPayload =
      buildSystemsApiRegistrationPayload("http://localhost:8080");
    expect(payload).toBeDefined();
  });
});
