import { openControlPlaneDatabase, migrateControlPlaneDatabase } from "../packages/app/src/server/control-plane/database/client"
const command = Bun.argv[2] || "check"
const filename = process.env.CONTROL_PLANE_DB || ".data/control-plane.sqlite"
if (command === "generate") { console.log("control-plane schema is defined in packages/app/src/server/control-plane/database/schema.ts"); process.exit(0) }
const db = openControlPlaneDatabase(filename)
if (command === "migrate") { migrateControlPlaneDatabase(db); console.log(`control-plane migrated (${filename})`); process.exit(0) }
if (command === "check") { migrateControlPlaneDatabase(db); db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_backends'").get(); console.log("control-plane schema ok"); process.exit(0) }
throw new Error(`Unknown database command: ${command}`)
