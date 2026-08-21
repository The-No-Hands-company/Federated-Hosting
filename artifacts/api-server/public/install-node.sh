#!/bin/sh
# Nexus node enrolment.
#
# Generates this machine's federation identity, proves it holds it, and
# registers the public half. The private key is written to this machine and
# never transmitted — not to Nexus, not to anyone. If you read nothing else in
# this script, read the openssl and curl lines: there are only two, and neither
# sends the private key anywhere.
#
#   sh install-node.sh --token <enrolment-token> --api https://hosting.tnhc.dev
#
# POSIX sh, no dependencies beyond openssl and curl.

set -eu

TOKEN=""
API=""
KEY_DIR="${NEXUS_KEY_DIR:-/etc/nexus}"

while [ $# -gt 0 ]; do
    case "$1" in
        --token) TOKEN="${2:?--token needs a value}"; shift 2 ;;
        --api)   API="${2:?--api needs a value}"; shift 2 ;;
        --key-dir) KEY_DIR="${2:?--key-dir needs a value}"; shift 2 ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

[ -n "$TOKEN" ] || { echo "error: --token is required" >&2; exit 2; }
[ -n "$API" ]   || { echo "error: --api is required" >&2; exit 2; }

command -v openssl >/dev/null 2>&1 || { echo "error: openssl is required" >&2; exit 1; }
command -v curl    >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

PRIVATE_KEY="$KEY_DIR/node.key"
PUBLIC_KEY="$KEY_DIR/node.pub"

# Refuse to clobber an existing identity. Overwriting the key of a node that
# peers already trust would silently break every federation relationship it
# has, and the old key would be unrecoverable.
if [ -f "$PRIVATE_KEY" ]; then
    echo "error: $PRIVATE_KEY already exists." >&2
    echo "       This machine already has a node identity. Remove it deliberately" >&2
    echo "       if you intend to re-enrol — peers trusting the old key will need" >&2
    echo "       to re-verify this node." >&2
    exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

echo "Generating Ed25519 node identity in $KEY_DIR ..."

# umask before generation, not chmod after: a private key must never exist on
# disk world-readable, even for the instant between creation and chmod.
OLD_UMASK=$(umask)
umask 077
openssl genpkey -algorithm ed25519 -out "$PRIVATE_KEY" 2>/dev/null
umask "$OLD_UMASK"

openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
chmod 644 "$PUBLIC_KEY"

echo "  private key: $PRIVATE_KEY (never leaves this machine)"
echo "  public key:  $PUBLIC_KEY"

# Prove possession: sign the enrolment token with the key just generated. The
# server verifies this against the public key being registered, so a token
# alone cannot register somebody else's key.
#
# The token goes to a file rather than a pipe. Ed25519 signing is one-shot and
# OpenSSL needs to know the input length up front, so `printf | openssl pkeyutl
# -rawin` fails with "unable to determine file size for oneshot" — and, piped
# into base64, fails *silently* as an empty signature. Every enrolment would
# have been rejected for a bad signature with nothing explaining why.
TOKEN_FILE="$KEY_DIR/.enrol-token.$$"
SIG_FILE="$KEY_DIR/.enrol-sig.$$"
trap 'rm -f "$TOKEN_FILE" "$SIG_FILE"' EXIT INT TERM

umask 077
printf '%s' "$TOKEN" > "$TOKEN_FILE"

if ! openssl pkeyutl -sign -inkey "$PRIVATE_KEY" -rawin \
        -in "$TOKEN_FILE" -out "$SIG_FILE" 2>/dev/null; then
    echo "error: failed to sign the enrolment token." >&2
    echo "       openssl must be 3.0 or newer for Ed25519 (-rawin)." >&2
    echo "       This machine has: $(openssl version)" >&2
    exit 1
fi
umask "$OLD_UMASK"

SIGNATURE=$(openssl base64 -A -in "$SIG_FILE")

# An Ed25519 signature is 64 bytes, which is 88 base64 characters. Checking it
# is not pedantry: the silent-empty-signature failure above is exactly the kind
# that reaches the server as an unexplained rejection.
if [ "${#SIGNATURE}" -ne 88 ]; then
    echo "error: signature is ${#SIGNATURE} characters, expected 88." >&2
    echo "       The key or openssl build is not producing Ed25519 signatures." >&2
    exit 1
fi

PUBLIC_KEY_PEM=$(cat "$PUBLIC_KEY")

echo "Claiming node at $API ..."

# Body built with a heredoc and jq-free JSON escaping: the PEM contains
# newlines, which must become \n rather than breaking the document.
ESCAPED_PEM=$(printf '%s' "$PUBLIC_KEY_PEM" | awk '{printf "%s\\n", $0}')

RESPONSE=$(curl -fsS -X POST "$API/api/nodes/claim" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\",\"publicKey\":\"$ESCAPED_PEM\",\"signature\":\"$SIGNATURE\"}" \
    2>&1) || {
        echo "error: claim failed" >&2
        echo "$RESPONSE" >&2
        echo "" >&2
        echo "The key pair above is still valid. Ask an operator for a fresh" >&2
        echo "enrolment token and re-run with --key-dir pointing here, or remove" >&2
        echo "$KEY_DIR and start again." >&2
        exit 1
    }

echo ""
echo "Node enrolled."
echo "$RESPONSE"
echo ""
echo "Keep $PRIVATE_KEY safe and backed up. It is this node's identity in the"
echo "federation; nobody else has a copy, including Nexus, so it cannot be"
echo "recovered if lost — only replaced by enrolling again."
