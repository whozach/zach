/**
 * Unit test for /validate rate-limit key selection.
 * Spec §6 / §11.8: verify the token signature first; forged tokens must
 * never consume another license's limiter (they use the IP key instead).
 */
import { licenseRouteLimiter } from "../worker/index.js";

const LIC = "lic_ABCDEFGHJKMNPQRS";
const IP = "203.0.113.10";
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const forged = licenseRouteLimiter(false, LIC, IP);
check(
  "forged token uses the IP limiter, not the license id",
  forged.binding === "RL_PUBLIC" && forged.key === `a:${IP}`,
  JSON.stringify(forged),
);
check(
  "forged token key does not contain the license id",
  !String(forged.key).includes(LIC),
  JSON.stringify(forged),
);

const missingLic = licenseRouteLimiter(true, null, IP);
check(
  "verified token without a license id falls back to the IP limiter",
  missingLic.binding === "RL_PUBLIC" && missingLic.key === `a:${IP}`,
  JSON.stringify(missingLic),
);

const ok = licenseRouteLimiter(true, LIC, IP);
check(
  "verified token uses the per-license limiter",
  ok.binding === "RL_LICENSE" && ok.key === `l:${LIC}`,
  JSON.stringify(ok),
);

if (failed) {
  console.log(`\n${failed} unit check(s) failed.`);
  process.exit(1);
}
console.log("\nAll rate-limit ordering unit checks passed.");
