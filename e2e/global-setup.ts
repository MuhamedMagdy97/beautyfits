import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { MAIL_DIR, MEDIA_DIR, serverEnv, WHATSAPP_DIR } from "./config";

/** Fresh database and empty local outboxes before every E2E run (ADR-0071). */
export default function globalSetup(): void {
  for (const dir of [MAIL_DIR, WHATSAPP_DIR, MEDIA_DIR]) {
    rmSync(dir, { recursive: true, force: true });
  }
  execSync("npx tsx e2e/setup-db.ts", {
    stdio: "inherit",
    env: { ...process.env, ...serverEnv(), NODE_ENV: "development" },
  });
}
