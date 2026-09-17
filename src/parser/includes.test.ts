import { describe, expect, it } from "vitest";
import { buildTopology, expandIncludes, parseNginxConfig } from "./index";

describe("include expansion", () => {
  it("attaches a glob-included location file to the server that includes it", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/nginx.conf:
http {
  include /etc/nginx/conf.d/*.conf;
  include /etc/nginx/conf.d/*.upstream;
}

# configuration file /etc/nginx/conf.d/app.conf:
server {
  listen 8080;
  server_name app.local;
  include /etc/nginx/conf.d/*.location;
}

# configuration file /etc/nginx/conf.d/app.location:
location /api {
  proxy_pass http://app_pool;
}

# configuration file /etc/nginx/conf.d/upstreams.upstream:
upstream app_pool {
  server 127.0.0.1:9000;
}
`);

    const server = graph.routing?.servers.find((candidate) => candidate.names.includes("app.local"));
    expect(server?.locations.map((location) => location.pattern)).toEqual(["/api"]);
    expect(graph.nodes.some((node) => node.type === "route" && node.source?.file === "/etc/nginx/conf.d/app.location")).toBe(true);
    expect(graph.edges.some((edge) => edge.label === "proxy_pass")).toBe(true);
  });

  it("gives each including server its own copy of a shared include", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/nginx.conf:
http {
  include /etc/nginx/conf.d/*.conf;
}

# configuration file /etc/nginx/conf.d/a.conf:
server {
  listen 80;
  server_name a.local;
  include /etc/nginx/conf.d/*.location;
}

# configuration file /etc/nginx/conf.d/b.conf:
server {
  listen 81;
  server_name b.local;
  include /etc/nginx/conf.d/*.location;
}

# configuration file /etc/nginx/conf.d/shared.location:
location /shared {
  return 200;
}
`);

    const a = graph.routing?.servers.find((server) => server.names.includes("a.local"));
    const b = graph.routing?.servers.find((server) => server.names.includes("b.local"));
    expect(a?.locations.map((location) => location.pattern)).toEqual(["/shared"]);
    expect(b?.locations.map((location) => location.pattern)).toEqual(["/shared"]);

    const routeIds = graph.nodes
      .filter((node) => node.type === "route" && node.label === "location /shared")
      .map((node) => node.id);
    expect(routeIds).toHaveLength(2);
    expect(new Set(routeIds).size).toBe(2);
  });

  it("restores the stream context for a tcp include", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/nginx.conf:
events {}

stream {
  include /etc/nginx/conf.d/*.tcp;
}

http {}

# configuration file /etc/nginx/conf.d/default.tcp:
upstream tcp_pool {
  server 127.0.0.1:9000;
}

server {
  listen 9001;
  proxy_pass tcp_pool;
}
`);

    const server = graph.nodes.find((node) => node.type === "server");
    expect(server?.subtitle).toBe("stream");
    expect(graph.nodes.some((node) => node.type === "entry" && node.label === "stream 9001")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "upstream" && node.label === "tcp_pool")).toBe(true);
  });

  it("terminates cyclic includes", () => {
    const graph = buildTopology(`# configuration file /etc/nginx/conf.d/a.conf:
include /etc/nginx/conf.d/b.conf;

server {
  listen 80;
  server_name a.local;
}

# configuration file /etc/nginx/conf.d/b.conf:
include /etc/nginx/conf.d/a.conf;
`);

    expect(graph.nodes.filter((node) => node.type === "server")).toHaveLength(1);
  });

  it("keeps unresolved includes inert", () => {
    const input = `# configuration file /etc/nginx/nginx.conf:
http {
  include /etc/nginx/conf.d/missing.location;
  server {
    listen 80;
  }
}
`;
    const expanded = expandIncludes(parseNginxConfig(input).ast);
    const http = expanded.children.find((child) => child.name === "http");
    expect(JSON.stringify(http)).toContain("missing.location");

    const graph = buildTopology(input);
    expect(graph.nodes.filter((node) => node.type === "server")).toHaveLength(1);
  });

  it("leaves configurations without file markers unchanged", () => {
    const input = "http { server { listen 80; location / { return 200; } } }";
    const ast = parseNginxConfig(input).ast;
    expect(expandIncludes(ast)).toBe(ast);
  });
});
