import assert from "node:assert/strict";
import { readTestMode } from "../docs/js/test-mode.js";

function location(hostname, search) {
  return { hostname, search };
}

assert.deepEqual(
  readTestMode(location("localhost", "?testMode=1")),
  { providers: ["netflix"] }
);
assert.deepEqual(
  readTestMode(location("127.0.0.1", "?testMode=1&testProviders=Netflix,%20prime,unknown,netflix")),
  { providers: ["netflix", "prime"] }
);
assert.deepEqual(
  readTestMode(location("localhost", "?testProviders=unknown,,not-a-provider&testMode=1")),
  { providers: ["netflix"] }
);

for (const blocked of [
  location("example.com", "?testMode=1&testProviders=netflix"),
  location("github.io", "?testMode=1"),
  location("localhost.evil.test", "?testMode=1"),
  location("127.0.0.1.evil.test", "?testMode=1"),
  location("localhost", ""),
  location("localhost", "?testMode=true"),
  location("localhost", "?testMode=01"),
  location("localhost", "?testMode=1%"),
  location("localhost", null),
  null,
  "http://localhost/?testMode=1"
]) {
  assert.equal(readTestMode(blocked), null);
}

console.log("check_test_mode: OK");
