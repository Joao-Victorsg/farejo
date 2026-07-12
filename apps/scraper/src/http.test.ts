import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "./http.js";

describe("fetchText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the body on a 2xx response, first try", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("hello", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchText("https://example.test")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a non-2xx response and returns the body once it recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("recovered", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchText("https://example.test");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 tentativas no total) and throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchText("https://example.test");
    const assertion = expect(result).rejects.toThrow("HTTP 500");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
