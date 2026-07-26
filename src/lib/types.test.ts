import { describe, expect, it } from "vitest";
import {
  createSessionProfile,
  duplicateSessionProfile,
} from "./types";

describe("duplicateSessionProfile", () => {
  it("creates an independent profile with a new identity", () => {
    const source = createSessionProfile();
    source.name = "开发板";
    source.serial.baudRate = 115_200;

    const duplicate = duplicateSessionProfile(source);

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.name).toBe("开发板 副本");
    expect(duplicate.serial).not.toBe(source.serial);
    expect(duplicate.terminal).not.toBe(source.terminal);
    expect(duplicate.serial.baudRate).toBe(115_200);
  });
});
