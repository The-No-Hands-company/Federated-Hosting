/**
 * Test environment preamble.
 *
 * @workspace/db throws at import time when DATABASE_URL is unset, so any test
 * whose import graph reaches it fails to load — not to fail an assertion, but
 * to collect at all. Three unit files did exactly that, and the suite still
 * reported the remaining 283 as passing, so a clean-shell run looked fine
 * while a tenth of the files never executed.
 *
 * The value is deliberately unreachable. These are unit tests: they exercise
 * pure functions whose modules merely sit downstream of the db import, and
 * none of them opens a connection. A real-looking URL here would be worse —
 * it invites a test to quietly connect to something.
 */
// No credentials in it, deliberately. The first draft used a user:pass URL and
// detect-secrets refused the commit — correctly, since "obviously fake" is not
// something a scanner can know. Nothing here needs them: @workspace/db only
// checks that the variable is non-empty, and port 1 is unbindable anyway.
process.env.DATABASE_URL ??= "postgresql://127.0.0.1:1/nexus-tests-never-connects";
