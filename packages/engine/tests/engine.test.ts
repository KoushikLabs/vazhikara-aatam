import { describe, expect, it } from "vitest";
import { ENGINE_NAME, ENGINE_VERSION, getEngineInfo } from "../src/index.js";

describe("engine package surface", () => {
  it("exposes its name and version (used by server and web for linkage checks)", () => {
    expect(ENGINE_NAME).toBe("vazhikara-engine");
    expect(getEngineInfo()).toEqual({ name: ENGINE_NAME, version: ENGINE_VERSION });
  });
});
