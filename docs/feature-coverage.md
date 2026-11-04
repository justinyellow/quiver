# Feature coverage vs Postman (Team/Enterprise) and community wishlist

| Area | Postman | Quiver | Notes |
|---|---|---|---|
| Collections, folders, requests, examples | ✓ | ✓ | drag/drop move, alphabetical sort (top community request) |
| Workspaces, roles (admin/editor/viewer) | ✓ | ✓ | personal + team workspaces |
| Comments, version history, fork/merge | ✓ (Team+) | ✓ | per-save revisions with restore; fork → diff → merge/pull |
| Environments, globals, collection vars | ✓ | ✓ | plus layered/multiple environments (wishlist #8) |
| Secret vault | ✓ (Vault) | ✓ | encrypted at rest, masked, reveal audited |
| Scripting (pm.*) | ✓ | ✓ | QuickJS sandbox, require shims |
| Collection runner + data files | ✓ | ✓ | live SSE results, JUnit |
| Newman / CLI | ✓ | ✓ | `server/src/cli.ts`, API tokens |
| Mock servers | ✓ | ✓ | examples, path params, delays, private key |
| Monitors | ✓ (quota) | ✓ unlimited | cron, webhook/email, uptime history |
| Performance testing | ✓ (paid VUh) | ✓ | VUs/duration/ramp, percentiles |
| API docs publishing | ✓ | ✓ | public link, code samples |
| OpenAPI import/export | ✓ | ✓ | 3.x + Swagger 2 in, 3.0 out (wishlist #14) |
| Postman/Insomnia/Bruno/HAR/cURL import | partial | ✓ | |
| Git-friendly plain-text export | ✗ | ✓ | one YAML per request (wishlist #2) |
| GraphQL | ✓ | ✓ body mode | no schema explorer yet |
| WebSocket | ✓ | ✓ | via server proxy |
| SSE / streaming | ✗ | ✓ | stream setting (wishlist #12) |
| gRPC, MQTT, Socket.IO | ✓ | ✗ | roadmap |
| OAuth2 auto-refresh, PKCE | ✓ | ✓ | wishlist #15 |
| AWS SigV4, Digest | ✓ | ✓ | NTLM/Kerberos/Hawk not yet |
| SSO (OIDC), 2FA, audit logs | Enterprise | ✓ | SCIM not yet |
| Prompt on unresolved variable | ✗ (closed 2024) | ✓ | wishlist #9 |
| Autosave | ✓ | ✓ toggle | wishlist #10 |
| Side-by-side layout | ✗ | ✓ | wishlist #11 |
| Flows, Postbot/AI, Private API Network | ✓ | ✗ | not planned for v1 |
| Self-hosted / on-prem | ✗ | ✓ | the point |

## Suggested next steps
- gRPC (reflection) and MQTT clients
- GraphQL schema explorer via introspection
- mTLS client certificates per host (engine already supports `clientCerts`, needs UI + storage)
- SCIM provisioning; SAML
- Request tags, bulk multi-select
- Real-time presence / live collaboration cursors
