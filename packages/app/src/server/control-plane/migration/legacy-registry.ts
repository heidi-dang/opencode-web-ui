export type MigrationState = "LEGACY_ONLY" | "IMPORTING" | "DATABASE_PRIMARY"
export function nextMigrationState(state: MigrationState, imported: boolean): MigrationState { if (state === "LEGACY_ONLY") return imported ? "DATABASE_PRIMARY" : "IMPORTING"; if (state === "IMPORTING") return imported ? "DATABASE_PRIMARY" : "IMPORTING"; return "DATABASE_PRIMARY" }
export function canReadLegacy(state: MigrationState) { return state === "LEGACY_ONLY" }
export function canWriteLegacy(_state: MigrationState) { return false }
export function migrationLog(state: MigrationState) { return `[control-plane] registry migration state=${state}` }
