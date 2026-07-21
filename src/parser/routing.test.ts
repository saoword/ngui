import { describe, expect, it } from "vitest";
import { buildTopology, simulateRequest, suggestRequestInputs } from "./index";

describe("request routing simulation", () => {
  it("matches exact locations before prefix locations", () => {
    const graph = buildTopology(`
      http {
        upstream app { server 127.0.0.1:8080; }
        server {
          listen 80;
          server_name example.com;
          location /api { proxy_pass http://app; }
          location = /api/health { return 200; }
        }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/api/health",
      scheme: "http",
      port: 80
    });

    expect(result.status).toBe("matched");
    expect(result.summary).toContain("location /api/health");
    expect(result.nodeIds.some((id) => id.startsWith("route-"))).toBe(true);
  });

  it("uses first matching regex after normal prefix matching", () => {
    const graph = buildTopology(`
      http {
        server {
          listen 80;
          server_name example.com;
          location /assets { return 200; }
          location ~ \\.php$ { return 404; }
        }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/assets/index.php",
      scheme: "http",
      port: 80
    });

    expect(result.status).toBe("matched");
    expect(result.summary).toContain("location \\.php$");
  });

  it("checks regex after the longest prefix unless that prefix is ^~", () => {
    const graph = buildTopology(`
      http {
        server {
          listen 80;
          server_name example.com;
          location ^~ /assets { return 200; }
          location /assets/images { return 200; }
          location ~ \\.php$ { return 404; }
        }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/assets/images/logo.php",
      scheme: "http",
      port: 80
    });

    expect(result.summary).toContain("location \\.php$");
  });

  it("marks dynamic variable routes as low confidence", () => {
    const graph = buildTopology(`
      http {
        map $host $backend { default app; }
        server {
          listen 80;
          server_name example.com;
          location /api { proxy_pass http://$backend; }
        }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/api/users",
      scheme: "http",
      port: 80
    });

    expect(result.status).toBe("matched");
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("Dynamic variable target lowers confidence.");
  });

  it("returns no highlighted route when the requested port is empty or unmatched", () => {
    const graph = buildTopology(`
      http {
        server {
          listen 80;
          server_name example.com;
          location / { return 200; }
        }
      }
    `);

    const emptyPort = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/",
      scheme: "http"
    });
    const missingPort = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/",
      scheme: "http",
      port: 9000
    });

    expect(emptyPort.status).toBe("no-server");
    expect(emptyPort.nodeIds).toEqual([]);
    expect(missingPort.status).toBe("no-server");
    expect(missingPort.nodeIds).toEqual([]);
  });

  it("uses host to choose between server_name values on the same port", () => {
    const graph = buildTopology(`
      http {
        server {
          listen 80;
          server_name app.example.com;
          location / { return 200; }
        }
        server {
          listen 80;
          server_name api.example.com;
          location /v1 { return 200; }
        }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "api.example.com",
      path: "/v1/users",
      scheme: "http",
      port: 80
    });

    expect(result.status).toBe("matched");
    expect(result.summary).toContain("api.example.com/v1/users");
    expect(result.reasons).toContain("Server name matched api.example.com.");
  });

  it("returns an explained route trace with source locations", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/app.conf:
http {
  server {
    listen 80;
    server_name example.com;
    location /api { proxy_pass http://app; }
  }
}

# configuration file /etc/nginx/upstreams.conf:
upstream app { server 127.0.0.1:8080; }
`);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "example.com",
      path: "/api/users",
      scheme: "http",
      port: 80
    }, graph.nodes);

    expect(result.candidates).toHaveLength(1);
    expect(result.steps.map((step) => step.kind)).toEqual(["request", "server", "location", "upstream", "target"]);
    expect(result.steps[1].source).toEqual({ line: 3, column: 3, file: "/etc/nginx/app.conf" });
    expect(result.steps[2].reason).toContain("prefix");
    expect(result.steps[3].source?.file).toBe("/etc/nginx/upstreams.conf");
  });

  it("suggests request inputs from configured servers and locations", () => {
    const graph = buildTopology(`
      http {
        server {
          listen 443 ssl;
          server_name secure.example.com;
          location /health { return 200; }
        }
      }
    `);

    expect(suggestRequestInputs(graph.routing)).toEqual([
      { host: "secure.example.com", path: "/health", scheme: "https", port: 443 }
    ]);
  });

  it("keeps fallback server matches as candidate paths when host is ambiguous", () => {
    const graph = buildTopology(`
      http {
        server { listen 80; server_name app.example.com; location /app { return 200; } }
        server { listen 80; server_name api.example.com; location /api { return 200; } }
      }
    `);

    const result = simulateRequest(graph.routing, graph.edges, {
      host: "unknown.example.com",
      path: "/api/users",
      scheme: "http",
      port: 80
    }, graph.nodes);

    expect(result.status).toBe("matched");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.status)).toEqual(["no-location", "matched"]);
    expect(result.candidates[1].steps.at(-1)?.source?.line).toBe(4);
  });

  it("keeps source metadata on topology edges", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/app.conf:
http { server { listen 80; location / { proxy_pass http://app; } } }`);

    const passEdge = graph.edges.find((edge) => edge.label === "proxy_pass");
    expect(passEdge?.sourceLocation).toEqual({ line: 2, column: 41, file: "/etc/nginx/app.conf" });
  });
});
