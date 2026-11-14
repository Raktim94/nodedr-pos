# AGENTS.md — NodeDR POS

## Integrating with NodeDR POS
Read [`prompts/AI_INTEGRATION_PROMPT.md`](prompts/AI_INTEGRATION_PROMPT.md). Essentials: REST at `/api/external` and MCP at `/mcp`, both with scoped `nk_live_…` keys from Settings → Integrations; products need a SKU; call server-side only; webhooks are HMAC-signed; there is no OpenAPI spec or SDK. Schemas: [`docs/API.md`](docs/API.md), [`docs/CUSTOM_STORE.md`](docs/CUSTOM_STORE.md). Self-hosted: ask for the shop URL and key, never invent or commit them.

## Working on this repo
Default branch `master`. See `CONTRIBUTING.md`. No Co-Authored-By trailers.
