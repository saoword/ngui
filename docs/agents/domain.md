# Domain Docs

Engineering skills consume this repo's domain documentation as follows.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists.
- **`docs/adr/`** — read ADRs touching the area being changed.

If these files don't exist, proceed silently. `/domain-modeling` creates them lazily.

## File structure

Single-context repo:

/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-example-decision.md
│   └── 0002-another-decision.md
└── src/

## Use the glossary's vocabulary

When naming domain concepts, use terms defined in `CONTEXT.md`. If a needed concept is absent, flag it for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
