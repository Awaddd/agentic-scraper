import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./normalizeUrl.js";

describe("normalizeUrl", () => {
  it("prepends the target origin to a relative listing URL", () => {
    expect(normalizeUrl("/jobs/software-engineer", "https://weworkremotely.com")).toBe(
      "https://weworkremotely.com/jobs/software-engineer",
    );
  });

  it("leaves an already-absolute URL unchanged", () => {
    expect(normalizeUrl("https://remoteok.com/jobs/123", "https://weworkremotely.com")).toBe(
      "https://remoteok.com/jobs/123",
    );
  });
});
