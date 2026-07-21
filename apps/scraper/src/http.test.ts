import { NotFoundError, RetryableError } from "@farejo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpStatusError, fetchText, fetchTextResponse } from "./http.js";

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

  it("preserves the final URL when an adapter needs to inspect redirects", async () => {
    const response = new Response("hello", { status: 200 });
    Object.defineProperty(response, "url", { value: "https://example.test/final" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchTextResponse("https://example.test/start")).resolves.toEqual({
      text: "hello",
      finalUrl: "https://example.test/final",
    });
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

  it("returns 404 as a terminal NotFoundError without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchText("https://example.test/missing")).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("preserves the exhausted HTTP status and URL as structured internal data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 405 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchText("https://example.test/method-blocked");
    const assertion = expect(result).rejects.toMatchObject({
      name: "HttpStatusError",
      status: 405,
      url: "https://example.test/method-blocked",
    } satisfies Partial<HttpStatusError>);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes a network failure into RetryableError after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchText("https://example.test");
    const assertion = expect(result).rejects.toBeInstanceOf(RetryableError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes a timeout into RetryableError after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("request timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchText("https://example.test");
    const assertion = expect(result).rejects.toBeInstanceOf(RetryableError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
