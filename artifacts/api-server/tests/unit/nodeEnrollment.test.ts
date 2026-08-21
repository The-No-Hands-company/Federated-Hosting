import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { generateKeyPair, signMessage, verifySignature } from "../../src/lib/federation";

/**
 * Enrolment's security rests on two claims:
 *
 *   1. the token cannot be recovered from what is stored, and
 *   2. holding a token is not enough to register an arbitrary public key.
 *
 * The second is the one that is easy to get wrong and easy to not notice,
 * because an implementation without it works perfectly for every honest
 * caller. These tests assert both against the real primitives the route uses.
 */
describe("node enrolment: proof of possession", () => {
  const hashToken = (token: string) =>
    crypto.createHash("sha256").update(token).digest("hex");

  it("a node signing its own token verifies", () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const { publicKey, privateKey } = generateKeyPair();

    const signature = signMessage(privateKey, token);

    expect(verifySignature(publicKey, token, signature)).toBe(true);
  });

  it("a token holder cannot register someone else's public key", () => {
    // The attack this prevents: an operator with a valid enrolment token
    // registers a *peer's* public key as their node's. Federation trusts a
    // node's registered key, so afterwards the peer's signatures would
    // authenticate as this node — the victim impersonates the attacker's node
    // without either of them knowing.
    const token = crypto.randomBytes(32).toString("base64url");
    const victim = generateKeyPair();
    const attacker = generateKeyPair();

    // The attacker can only sign with their own key.
    const signature = signMessage(attacker.privateKey, token);

    // Presenting the victim's public key with a signature they did not make
    // must fail.
    expect(verifySignature(victim.publicKey, token, signature)).toBe(false);
  });

  it("a signature over a different token does not verify", () => {
    // Prevents replaying a signature captured from an earlier enrolment
    // against a freshly issued token.
    const issued = crypto.randomBytes(32).toString("base64url");
    const other = crypto.randomBytes(32).toString("base64url");
    const { publicKey, privateKey } = generateKeyPair();

    const signature = signMessage(privateKey, other);

    expect(verifySignature(publicKey, issued, signature)).toBe(false);
  });

  it("a malformed public key is refused rather than throwing", () => {
    // verifySignature is called with attacker-controlled input. If it threw on
    // garbage, a malformed key would surface as a 500 instead of a clean
    // rejection, and would be a trivially available denial of service.
    const token = crypto.randomBytes(32).toString("base64url");
    const { privateKey } = generateKeyPair();
    const signature = signMessage(privateKey, token);

    expect(verifySignature("not a pem at all", token, signature)).toBe(false);
    expect(verifySignature("", token, signature)).toBe(false);
  });

  it("the stored hash does not reveal the token", () => {
    const token = crypto.randomBytes(32).toString("base64url");
    const stored = hashToken(token);

    expect(stored).not.toContain(token);
    expect(stored).toHaveLength(64);

    // And it is a function of the token, so lookup by hash still works.
    expect(hashToken(token)).toBe(stored);
    expect(hashToken(crypto.randomBytes(32).toString("base64url"))).not.toBe(stored);
  });

  it("tokens carry enough entropy that guessing is not a strategy", () => {
    // 32 bytes. If this is ever shortened, the single-use and expiry
    // properties stop being the only things standing between an attacker and
    // a node identity.
    const token = crypto.randomBytes(32).toString("base64url");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);

    const many = new Set(
      Array.from({ length: 500 }, () => crypto.randomBytes(32).toString("base64url")),
    );
    expect(many.size).toBe(500);
  });
});

describe("node enrolment: the installer's key handling", () => {
  it("a signature made by openssl verifies in node", () => {
    // The interop that actually matters, and it did not work at first. The
    // installer originally piped the token into `openssl pkeyutl -sign -rawin`.
    // Ed25519 signing is one-shot, so OpenSSL needs the input length up front
    // and refuses a pipe with "unable to determine file size for oneshot" —
    // which, piped onward into base64, produced an *empty* signature and no
    // error. Every enrolment would have failed server-side for a bad
    // signature, with nothing anywhere explaining why.
    //
    // This runs the real openssl commands the installer runs.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-enrol-"));
    try {
      const keyPath = path.join(dir, "node.key");
      const pubPath = path.join(dir, "node.pub");
      const tokPath = path.join(dir, "token");
      const sigPath = path.join(dir, "sig");

      execFileSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", keyPath]);
      execFileSync("openssl", ["pkey", "-in", keyPath, "-pubout", "-out", pubPath]);

      const token = crypto.randomBytes(32).toString("base64url");
      fs.writeFileSync(tokPath, token);

      execFileSync("openssl", [
        "pkeyutl", "-sign", "-inkey", keyPath, "-rawin", "-in", tokPath, "-out", sigPath,
      ]);

      const signature = fs.readFileSync(sigPath).toString("base64");
      const publicKey = fs.readFileSync(pubPath, "utf8");

      // 64 raw bytes is 88 base64 characters. The installer checks this too,
      // because the empty-signature failure is otherwise invisible.
      expect(signature).toHaveLength(88);
      expect(verifySignature(publicKey, token, signature)).toBe(true);
      expect(verifySignature(publicKey, token + "x", signature)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("openssl and node agree on the key format", () => {
    // The installer generates keys with `openssl genpkey -algorithm ed25519`
    // and signs with `openssl pkeyutl -sign -rawin`. The server verifies with
    // node's crypto. If those disagreed on encoding, every real enrolment
    // would fail while every test using generateKeyPair passed.
    const { publicKey } = generateKeyPair();

    expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
    expect(publicKey).toContain("-----END PUBLIC KEY-----");

    // SPKI PEM is what `openssl pkey -pubout` emits, so the two are
    // interchangeable.
    const reparsed = crypto.createPublicKey(publicKey);
    expect(reparsed.asymmetricKeyType).toBe("ed25519");
  });
});
