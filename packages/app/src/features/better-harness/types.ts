/** Better Harness type definitions. Ported from better-harness-ui. */

export interface HarnessRunProgress {
  runId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progressPercent: number;
  stage?: string;
  errorMessage?: string;
  completedAt?: string;
}

export interface HarnessDimensionScore {
  dimension: string;
  score: number;
  findingCount: number;
  evidenceCoverage: number;
}

export interface HarnessEvidence {
  id: string;
  category: string;
  source: string;
  summary: string;
  path?: string;
  confidence: number;
  collectedAt: string;
  fingerprint: string;
}

export interface HarnessFinding {
  id: string;
  title: string;
  dimension: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in-progress" | "fixed" | "ignored" | "wont-fix";
  cause: string;
  impact: string;
  expectedOutput: string;
  evidence: HarnessEvidence[];
  recommendedVehicle: string;
  allowedPaths: string[];
  validationRequirements: string[];
  acceptanceCriteria: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface HarnessReport {
  schemaVersion: number;
  engineVersion: string;
  scoringVersion: string;
  generatedAt: string;
  project: { name: string; directory: string };
  overallScore: number;
  evidenceCoverage: number;
  dimensions: HarnessDimensionScore[];
  findings: HarnessFinding[];
  sessions: {
    analyzed: number;
    longSessions: number;
    failedSessions: number;
    repeatedFailures: number;
    compactions: number;
    permissionInterruptions: number;
  };
  assets: Record<string, number>;
}

export type HarnessDemoMode = "completed" | "running" | "failed";
