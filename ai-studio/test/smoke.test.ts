import { test, expect } from "bun:test";
import { MOCK_PROJECT_LIST, MOCK_SESSIONS, MOCK_PROVIDERS } from "../src/review-fixtures";

test("review mock environment exposes deterministic fixtures", () => {
  expect(MOCK_PROJECT_LIST.length).toBeGreaterThan(0);
  expect(MOCK_SESSIONS.length).toBeGreaterThan(0);
  expect(MOCK_PROVIDERS.length).toBeGreaterThan(0);
});
