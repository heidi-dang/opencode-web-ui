import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  AvailabilityResponseSchema,
  StartRunResponseSchema,
  CancelResponseSchema,
  PlanFixResponseSchema,
  SSEEnvelopeSchema,
  RunProgressPayloadSchema,
  validateAvailabilityResponse,
  validateStartRunResponse,
  validateCancelResponse,
} from "../schemas/harness-api";

describe("Better Harness API Schemas", () => {
  describe("AvailabilityResponseSchema", () => {
    it("validates available:true", () => {
      expect(AvailabilityResponseSchema.parse({ available: true })).toEqual({ available: true });
    });

    it("validates available:false with reason", () => {
      expect(AvailabilityResponseSchema.parse({ available: false, reason: "Not found" })).toEqual({
        available: false,
        reason: "Not found",
      });
    });

    it("rejects missing available field", () => {
      expect(() => AvailabilityResponseSchema.parse({})).toThrow();
    });
  });

  describe("StartRunResponseSchema", () => {
    it("validates accepted with runId", () => {
      expect(StartRunResponseSchema.parse({ accepted: true, runId: "run_123" })).toEqual({
        accepted: true,
        runId: "run_123",
      });
    });

    it("validates rejected without runId", () => {
      expect(StartRunResponseSchema.parse({ accepted: false })).toEqual({ accepted: false });
    });

    it("rejects empty runId", () => {
      expect(() => StartRunResponseSchema.parse({ accepted: true, runId: "" })).toThrow();
    });
  });

  describe("CancelResponseSchema", () => {
    it("validates accepted:true", () => {
      expect(CancelResponseSchema.parse({ accepted: true })).toEqual({ accepted: true });
    });

    it("rejects accepted:false", () => {
      expect(() => CancelResponseSchema.parse({ accepted: false })).toThrow();
    });
  });

  describe("PlanFixResponseSchema", () => {
    it("validates accepted with results", () => {
      const data = {
        accepted: true,
        results: [{
          findingId: "fnd_1",
          accepted: true,
          opencodeSessionId: "sess_abc123",
        }],
      };
      expect(PlanFixResponseSchema.parse(data)).toEqual(data);
    });

    it("validates rejected without session", () => {
      const data = {
        accepted: false,
        results: [{
          findingId: "fnd_1",
          accepted: false,
          error: "No OpenCode client",
        }],
      };
      expect(PlanFixResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe("SSEEnvelopeSchema", () => {
    it("validates run.progress envelope", () => {
      const data = {
        type: "run.progress",
        timestamp: "2026-07-28T12:00:00.000Z",
        data: { runId: "r1", status: "running" },
      } satisfies z.input<typeof SSEEnvelopeSchema>;
      expect(SSEEnvelopeSchema.parse(data)).toEqual(data);
    });

    it("validates connected envelope", () => {
      const data = {
        type: "connected",
        timestamp: "2026-07-28T12:00:00.000Z",
        data: { clientId: "c1" },
      } satisfies z.input<typeof SSEEnvelopeSchema>;
      expect(SSEEnvelopeSchema.parse(data)).toEqual(data);
    });
  });

  describe("validate helper functions", () => {
    it("validateAvailabilityResponse returns valid", () => {
      const r = validateAvailabilityResponse({ available: true });
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.value.available).toBe(true);
    });

    it("validateStartRunResponse returns valid", () => {
      const r = validateStartRunResponse({ accepted: true, runId: "r1" });
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.value.runId).toBe("r1");
    });

    it("validateCancelResponse rejects accepted:false", () => {
      const r = validateCancelResponse({ accepted: false });
      expect(r.valid).toBe(false);
    });
  });
});
