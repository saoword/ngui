# Nginx UI Topology Context

Nginx UI Topology helps operators and developers understand how an Nginx configuration may route requests. It turns a user-provided configuration snapshot into an explainable topology and diagnostic guidance while keeping the configuration in the browser.

## Inputs and outputs

**Configuration snapshot**:
A user-provided `nginx -T` output or Nginx configuration text representing configuration at a point in time.
_Avoid_: Live configuration, runtime state

**Routing topology**:
A visual representation of entry points, servers, routes, upstream groups, backend targets, variables, and their relationships derived from a configuration snapshot.
_Avoid_: Runtime request trace, guaranteed execution graph

**Route candidate**:
A possible request path identified from the snapshot for a supplied host, path, protocol, and port.
_Avoid_: Actual route, guaranteed route

**Static inference**:
An explainable conclusion derived from configuration text without executing Nginx or its modules.
_Avoid_: Runtime simulation, configuration validation

**Configuration issue**:
A parser error, risky configuration pattern, or advisory observation tied to evidence in the snapshot.
_Avoid_: Nginx error, production incident

**Source location**:
The file marker and line position in the snapshot that support a topology element, route candidate, or configuration issue.
_Avoid_: Runtime stack trace

**Confidence**:
An indication of how directly a topology element or route candidate follows from known configuration syntax and semantics.
_Avoid_: Probability, production guarantee

**Local-only session**:
A browser session in which configuration text, parsed results, and diagnostics remain on the user's device and are not uploaded or persisted as a configuration workspace.
_Avoid_: Cloud workspace, remote backup

**Topology export**:
A versioned JSON representation of derived topology and diagnostics, or a rendered PNG, that the user explicitly downloads for sharing or record-keeping.
_Avoid_: Configuration backup, live system snapshot

## Product boundary

**Supported Nginx subset**:
Common `http` and `stream` routing concepts documented by the product, including servers, listeners, server names, locations, rewrites, returns, upstreams, common pass directives, and backend entries.
_Avoid_: Full Nginx compatibility

**Unsupported runtime behavior**:
Lua, njs, third-party modules, complex dynamic behavior, include expansion, and other semantics that cannot be concluded reliably from the supplied text alone.
_Avoid_: Broken configuration

## Release language

**Public Beta**:
A publicly usable release whose documented behavior is valuable but whose supported Nginx subset and inference accuracy are still being validated against real configurations.
_Avoid_: Stable release, production guarantee
