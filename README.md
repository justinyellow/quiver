# Quiver

Self-hosted, web-based API platform — a drop-in replacement for Postman (Team/Enterprise features included) that runs entirely on your own infrastructure.

## Quick start (local dev)

```bash
docker compose up -d db          # Postgres on 127.0.0.1:5440
npm install
npm run dev                      # API on :4000, web on :5173
```
Open http://localhost:5173 — the first account you create becomes the instance admin. Everything else is invite-only by default.

## Production (Docker)

```bash
cp .env.example .env             # set SESSION_SECRET + ENCRYPTION_KEY (32+ random chars each), BASE_URL
docker compose --profile prod up -d --build
```
The `app` container serves the built UI and API on port 4000. Put it behind your reverse proxy with TLS and set `TRUST_PROXY=true`.

## Features

**Core client** — collections / folders / requests with drag-and-drop, params ⇄ URL sync, headers, bodies (JSON, raw, form-data with files, urlencoded, GraphQL, binary), auth (basic, bearer, API key, digest, OAuth 2.0 authorization-code+PKCE / client credentials / password / implicit with auto-refresh, AWS SigV4), request settings (redirects, TLS verify, timeout, cookies, streaming/SSE), response viewer (pretty/raw/preview, JSON path filter, headers, cookies, timings, redirects), save-as-example, code generation for 24 languages/tools, cURL paste import, history, variable autocomplete, prompt for unresolved variables, autosave toggle, side-by-side or stacked layout, command palette (Ctrl+K), dark/light theme.

**Scripting** — Postman-compatible `pm.*` API (pre-request and post-response at collection, folder and request level), chai-style `pm.expect`, `pm.response.to.*`, `pm.sendRequest`, `pm.execution.setNextRequest`, `pm.iterationData`, JSON schema assertions, built-in `require()` shims for crypto-js, uuid, lodash, moment, chai, ajv, tv4, xml2js. Scripts run server-side in a **QuickJS WebAssembly sandbox** with CPU and memory limits — no access to the host.

**Variables** — globals, collection and environment scopes, multiple environments layered on top of each other, dynamic `{{$guid}}`-style variables, **secret** variables encrypted at rest (AES-256-GCM), masked in the UI, audited on reveal, blanked on export.

**Collaboration** — team workspaces with admin/editor/viewer roles, invites (email or link), comments on requests and collections, version history with restore for every save, fork / diff / merge of collections, audit log per workspace and instance-wide.

**Automation** — collection runner (iterations, CSV/JSON data files, delay, stop-on-failure, live streaming results, JUnit export), monitors on cron schedules with webhook (Slack/Teams/Discord) and email alerts plus uptime history, mock servers that serve saved examples (path params, query substitution, response selection headers, optional key, request log), performance tests (virtual users, duration, ramp-up, p50/p90/p95/p99, throughput timeline), WebSocket client via server-side proxy, API tokens for CI, `npm run cli -w server -- run …` runner that exits non-zero on failure.

**Import / export** — Postman v2.0/v2.1 collections, environments and "export all" dumps, OpenAPI 3.x and Swagger 2 (JSON/YAML, with example generation from schemas), cURL, HAR, Insomnia v4, Bruno folders, Quiver JSON. Export to Postman v2.1, OpenAPI 3.0, Quiver JSON, or a **git-friendly plain-text folder** (one YAML file per request).

**Docs** — generated documentation per collection with code samples and examples, optional public link (scripts, auth values and secrets never included).

**In-app help** — a getting-started guide with trackable steps, a searchable features overview, and a how-to page for every feature (`web/src/help/*.md`). Open them from the **?** menu in the top bar, the **?** button on each screen, the command palette, or `F1` for the current screen.

**Security** — Argon2id passwords, signed httpOnly session cookies, CSRF origin checks, TOTP two-factor auth, OIDC SSO (Authelia, Keycloak, Entra, Google…), rate limiting, helmet CSP, SSRF guard with DNS pinning (link-local/metadata always blocked; private and loopback targets configurable; host blocklist), per-request TLS verification, response size caps, audit logging, invite-only signup.

## Configuration

See `.env.example`. Instance admins can also change signup, network policy, proxy and retention at runtime under *Instance admin → Settings*.

## Layout

```
server/   Fastify + Postgres API, execution engine (server/src/engine), importers/exporters
web/      React + Vite UI
docs/     research notes (Postman feature inventory, community wishlist)
```

## Tests

```bash
npm test -w server                         # engine + import/export tests
npx tsx --test web/src/lib/codegen/codegen.test.ts
```

## License

MIT. See [LICENSE](LICENSE).
