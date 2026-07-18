import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DownloadTooLargeError, isPublicRoutableAddress, resolveValidatedAddress, safeFetchBytes, UnsafeUrlError } from "./net.js";

describe("isPublicRoutableAddress", () => {
  it("accepts a public IPv4 address", () => {
    expect(isPublicRoutableAddress("93.184.216.34")).toBe(true);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(isPublicRoutableAddress("10.0.0.1")).toBe(false);
    expect(isPublicRoutableAddress("172.16.0.1")).toBe(false);
    expect(isPublicRoutableAddress("192.168.1.1")).toBe(false);
  });

  it("rejects loopback and link-local", () => {
    expect(isPublicRoutableAddress("127.0.0.1")).toBe(false);
    expect(isPublicRoutableAddress("169.254.169.254")).toBe(false); // metadata endpoint clássico de SSRF
  });

  it("rejects CGNAT and reserved/multicast ranges", () => {
    expect(isPublicRoutableAddress("100.64.0.1")).toBe(false);
    expect(isPublicRoutableAddress("240.0.0.1")).toBe(false);
    expect(isPublicRoutableAddress("255.255.255.255")).toBe(false);
  });

  it("rejects IPv6 loopback, link-local and unique-local", () => {
    expect(isPublicRoutableAddress("::1")).toBe(false);
    expect(isPublicRoutableAddress("fe80::1")).toBe(false);
    expect(isPublicRoutableAddress("fc00::1")).toBe(false);
  });

  it("accepts a public IPv6 address and validates the embedded IPv4 of a mapped address", () => {
    expect(isPublicRoutableAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicRoutableAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicRoutableAddress("::ffff:93.184.216.34")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isPublicRoutableAddress("not-an-ip")).toBe(false);
  });
});

describe("resolveValidatedAddress", () => {
  it("rejects localhost (resolves to loopback)", async () => {
    await expect(resolveValidatedAddress("localhost")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public IP literal without touching DNS", async () => {
    await expect(resolveValidatedAddress("93.184.216.34")).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("rejects a private IP literal", async () => {
    await expect(resolveValidatedAddress("10.1.2.3")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects a bracketed IPv6 loopback literal", async () => {
    await expect(resolveValidatedAddress("[::1]")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("safeFetchBytes", () => {
  it("rejects a disallowed protocol before ever attempting a connection", async () => {
    await expect(safeFetchBytes("http://93.184.216.34/logo.png")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  describe("against a controlled local HTTP server", () => {
    let server: Server;
    let baseUrl: string;
    let lastRequestPath = "";

    // 127.0.0.1 é loopback e a regra real SEMPRE o bloqueia (corretamente — ver testes de
    // isPublicRoutableAddress acima). Para exercitar redirect/tamanho/tempo/status contra um
    // servidor real, o teste troca só a fonte de confiança do endereço (ver doc de
    // `resolveAddress` em SafeFetchOptions); qualquer host fora do servidor de teste continua
    // sendo recusado, preservando o comportamento de "bloqueia hop pra endereço não confiável".
    async function fakeResolveOnlyTestServer(hostname: string) {
      if (hostname === "127.0.0.1") return { address: "127.0.0.1", family: 4 as const };
      throw new UnsafeUrlError(`endereço não confiável no cenário de teste: ${hostname}`);
    }

    function localOptions(overrides: Parameters<typeof safeFetchBytes>[1] = {}) {
      return { allowedProtocols: ["http:"], resolveAddress: fakeResolveOnlyTestServer, ...overrides };
    }

    beforeAll(async () => {
      server = createServer((req, res) => {
        lastRequestPath = req.url ?? "";
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/ok") {
          res.writeHead(200, { "content-type": "image/webp" });
          res.end(Buffer.from("small body"));
          return;
        }
        if (url.pathname === "/no-content-length-large") {
          res.writeHead(200, { "content-type": "image/webp" });
          res.write(Buffer.alloc(1024, 1));
          res.write(Buffer.alloc(1024, 2));
          res.end();
          return;
        }
        if (url.pathname === "/declares-oversized") {
          res.writeHead(200, { "content-type": "image/webp", "content-length": "999999999" });
          res.end(Buffer.from("tiny"));
          return;
        }
        if (url.pathname === "/redirect-once") {
          res.writeHead(302, { location: "/ok" });
          res.end();
          return;
        }
        if (url.pathname === "/redirect-loop") {
          res.writeHead(302, { location: "/redirect-loop" });
          res.end();
          return;
        }
        if (url.pathname === "/redirect-to-private") {
          res.writeHead(302, { location: `http://10.0.0.5:${(server.address() as AddressInfo).port}/ok` });
          res.end();
          return;
        }
        if (url.pathname === "/redirect-no-location") {
          res.writeHead(302);
          res.end();
          return;
        }
        if (url.pathname === "/slow") {
          // nunca responde dentro do timeout do teste — propositalmente sem res.end()
          return;
        }
        if (url.pathname === "/not-found") {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    afterEach(() => {
      lastRequestPath = "";
    });

    it("downloads a small body over an explicitly allowed protocol", async () => {
      const result = await safeFetchBytes(`${baseUrl}/ok`, localOptions());
      expect(result.bytes.toString()).toBe("small body");
      expect(result.contentType).toBe("image/webp");
      expect(result.finalUrl).toBe(`${baseUrl}/ok`);
    });

    it("follows a single redirect and lands on the final body", async () => {
      const result = await safeFetchBytes(`${baseUrl}/redirect-once`, localOptions());
      expect(result.bytes.toString()).toBe("small body");
      expect(lastRequestPath).toBe("/ok");
    });

    it("gives up after exceeding the redirect cap", async () => {
      await expect(safeFetchBytes(`${baseUrl}/redirect-loop`, localOptions({ maxRedirects: 2 }))).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it("rejects a redirect without a Location header", async () => {
      await expect(safeFetchBytes(`${baseUrl}/redirect-no-location`, localOptions())).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it("re-validates the redirect target and blocks a hop into an untrusted address", async () => {
      await expect(safeFetchBytes(`${baseUrl}/redirect-to-private`, localOptions())).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it("rejects a declared Content-Length above the cap without downloading the body", async () => {
      await expect(safeFetchBytes(`${baseUrl}/declares-oversized`, localOptions({ maxBytes: 1024 }))).rejects.toBeInstanceOf(
        DownloadTooLargeError,
      );
    });

    it("rejects a body that exceeds the cap even without a Content-Length header", async () => {
      await expect(safeFetchBytes(`${baseUrl}/no-content-length-large`, localOptions({ maxBytes: 512 }))).rejects.toBeInstanceOf(
        DownloadTooLargeError,
      );
    });

    it("times out against a server that never responds", async () => {
      await expect(safeFetchBytes(`${baseUrl}/slow`, localOptions({ timeoutMs: 100 }))).rejects.toThrow();
    });

    it("surfaces a non-2xx status as an error", async () => {
      await expect(safeFetchBytes(`${baseUrl}/not-found`, localOptions())).rejects.toThrow(/404/);
    });
  });
});
