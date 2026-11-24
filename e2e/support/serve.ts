// Playwright webServer entry: wipes this project's data folder, then runs the production server in this process.
// The wipe cannot live in globalSetup: Playwright starts web servers before globalSetup runs, so it would delete
// the folder under a server that has already created its key file.
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const dataDir = process.env.SALES_PULSE_DATA_DIR
const e2eRoot = resolve('.local-data/e2e')
// Never wipe a folder outside .local-data/e2e: a misconfigured env must not delete a real user data folder.
if (!dataDir || !resolve(dataDir).startsWith(e2eRoot)) {
  throw new Error(`SALES_PULSE_DATA_DIR must be inside ${e2eRoot} (got "${dataDir ?? ''}")`)
}
rmSync(dataDir, { recursive: true, force: true })

await import('../../server/index.ts')
