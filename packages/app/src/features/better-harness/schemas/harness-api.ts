/**
 * Zod schemas for Better Harness API contracts.
 * Ported from better-harness-ui (heidi-dang/better-harness-ui, PR #2).
 */
import { z } from "zod";

// ── HTTP Response Schemas ──────────────────────────────────────────────

export const AvailabilityResponseSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
}).strict();

export const StartRunResponseSchema = z.object({
  accepted: z.boolean(),
  runId: z.string().min(1).optional(),
  error: z.string().optional(),
}).strict();

export const CancelResponseSchema = z.object({
  accepted: z.literal(true),
  error: z.string().optional(),
}).strict();

export const PlanFixItemSchema = z.object({
  findingId: z.string().min(1),
  accepted: z.boolean(),
  /** Real OpenCode session ID (no prefix). */
  opencodeSessionId: z.string().optional(),
  /** Public-facing repair operation identifier. */
  repairOperationId: z.string().optional(),
  error: z.string().optional(),
}).strict();

export const PlanFixResponseSchema = z.object({
  accepted: z.boolean(),
  results: z.array(PlanFixItemSchema).optional(),
}).strict();

export const IgnoreResponseItemSchema = z.object({
  findingId: z.string().min(1),
  accepted: z.boolean(),
  error: z.string().optional(),
}).strict();

export const VerifyResponseItemSchema = z.object({
  findingId: z.string().min(1),
  accepted: z.boolean(),
  error: z.string().optional(),
}).strict();

// ── Run Progress Schema ────────────────────────────────────────────────

export const HarnessRunProgressSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  progressPercent: z.number().min(0).max(100),
  stage: z.string().optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().optional(),
}).strict();

// ── SSE Event Contract ─────────────────────────────────────────────────

export const SSESupportedEventEnum = z.enum([
  "connected", "heartbeat",
  "run.queued", "run.started", "collector.started", "collector.completed",
  "analysis.started", "finding.created", "run.progress", "report.completed",
  "run.cancelled", "run.failed",
]);

export const SSEEnvelopeSchema = z.object({
  type: SSESupportedEventEnum,
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const RunProgressPayloadSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.string().optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  updatedAt: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const ReportCompletedPayloadSchema = z.object({
  runId: z.string().min(1),
});

// ── Validator Helpers ──────────────────────────────────────────────────

function validateWith<T>(schema: z.ZodType<T>, _name: string, data: unknown): { valid: true; value: T } | { valid: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { valid: true, value: result.data };
  return { valid: false, error: result.error.message };
}

export function validateAvailabilityResponse(data: unknown) {
  return validateWith(AvailabilityResponseSchema, "AvailabilityResponse", data);
}

export function validateStartRunResponse(data: unknown) {
  return validateWith(StartRunResponseSchema, "StartRunResponse", data);
}

export function validateCancelResponse(data: unknown) {
  return validateWith(CancelResponseSchema, "CancelResponse", data);
}

export function validatePlanFixResponse(data: unknown) {
  return validateWith(PlanFixResponseSchema, "PlanFixResponse", data);
}

export function getPayloadValidator(type: string): z.ZodType<unknown> {
  switch (type) {
    case "run.progress": return RunProgressPayloadSchema;
    case "report.completed": return ReportCompletedPayloadSchema;
    default: return z.unknown();
  }
}
