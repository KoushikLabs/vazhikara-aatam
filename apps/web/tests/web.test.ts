import { describe, it, expect } from "vitest";
import { ENGINE_NAME, getEngineInfo } from "@vazhikara/engine";

describe("web placeholder", () => {
  it("can import ENGINE_NAME from the engine workspace package", () => {
    expect(ENGINE_NAME).toBe("vazhikara-engine");
  });

  it("getEngineInfo returns the expected shape", () => {
    const info = getEngineInfo();
    expect(info).toHaveProperty("name");
    expect(info).toHaveProperty("version");
    expect(typeof info.name).toBe("string");
    expect(typeof info.version).toBe("string");
  });
});
