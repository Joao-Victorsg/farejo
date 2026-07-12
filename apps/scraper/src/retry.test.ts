import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 100, sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure and succeeds within the retry budget, backing off between attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("recovered");

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 100, sleep })).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("throws the last error after exhausting all retries (1 tentativa inicial + N retries), backing off exponentially", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const err = new Error("still broken");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 100, sleep })).rejects.toThrow("still broken");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });
});
