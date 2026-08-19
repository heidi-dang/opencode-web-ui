import { test, expect } from "bun:test";
import { reviewPlatform, REVIEW_SERVER } from "../src/review-runtime";

test("review platform is isolated from production defaults", async () => {
  expect(reviewPlatform.platform).toBe("web");
  expect(reviewPlatform.version).toBe("1.0.0-review");
  const srv = await reviewPlatform.getDefaultServer();
  expect(srv).toBe("review://local");
  expect(REVIEW_SERVER.http.url).toBe("review://local");
});
