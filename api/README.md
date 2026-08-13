# Specification artifacts

These files are **generated outputs, vendored here** — the source of truth is
the typed API contract in the Matinee AI platform repository, which generates
and validates them on every build there.

| File | What it is |
| --- | --- |
| `openapi.json` | The v1 API as OpenAPI 3.1 — 208 operations, with JSON Schema under `components.schemas`. |
| `matinee.d.ts` | TypeScript definitions generated from `openapi.json` by openapi-typescript. The SDK's types derive from this file. |
| `postman-collection.json` | The same surface as a Postman collection. |

Do not edit these by hand: changes belong in the contract upstream, and the
files here are replaced wholesale when the specification changes.
