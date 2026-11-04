# Postman: most-requested features and pain points (ranked)

Evidence key: GH = github.com/postmanlabs/postman-app-support (👍 = +1 reactions, open unless noted); HN = Hacker News (points/comments); PC = community.postman.com.

## (a) Missing / most-requested features

1. **Local, no-account mode (Scratch Pad)** – work offline with no login. Removed Sept 2023 (v10.18); the single most repeated complaint everywhere. *HN "Postman now forces you to login" + Insomnia equivalent 180pts/157c; PC "Losing users after sunsetting Scratch Pad"; r/postman_api "Security concerns about ongoing use of Postman".*
2. **Git-friendly, plain-text collection storage** – diffable files instead of nested JSON with UUIDs; no proprietary version control. *HN Bruno thread 1538pts/400c (~8 explicit mentions); Hoppscotch #870 "Sync collections with Git repo" 107👍; HN 2023 comment: "We refuse to be shoehorned into a proprietary version control system."*
3. **Protobuf/gRPC request bodies and export** – #2801 protobuf 307👍 (open since 2017); #11252 "Export collections with WebSocket and gRPC requests" 193👍; gRPC #5194 489👍 (closed 2021). Roadmap boards exist only for gRPC and WebSocket.
4. **Sort requests in folder alphabetically** – #5222 281👍, open since 2018. Trivial-sounding but top-3 by votes.
5. **Reuse the same request across collections / reference another request from scripts** – #1535 144👍/218c (2015); #4193 160👍 (closed 2025); #697 172👍. People want DRY auth/login steps.
6. **Collection-level headers / default headers for all requests** – #8179 129👍; #1947 153👍 (closed 2019 but still cited).
7. **Read variables from OS environment / .env files** – #1603 111👍 (2015). Keeps secrets out of the app; Bruno #409 ".env per environment" 23👍.
8. **Multiple/nested/layered environments** – #4968 "select multiple environments" 99👍/72c; Bruno #292 "Nested environments" 36👍; Yaak HN thread asked for env-var sync across envs and activating several at once. Folder-level overrides (Insomnia-style) frequently cited as the model.
9. **Prompt for input on unknown variable** – #285 331👍/324c (2013, closed only 2024). Bruno #7036 "prompt variable dropdown" shows demand persists.
10. **Autosave** – #8195 356👍/242c (closed 2023), #4671 88👍; Hoppscotch #3437 22👍. Lack of autosave for years was a running joke.
11. **Side-by-side tabs / split view** – #9180 112👍.
12. **Server-Sent Events and streamed responses** – #6682 405👍/252c (closed 2023), #5040 128👍; wanted again now for LLM APIs. Yaak praised for SSE.
13. **Chunked transfer / HTTP/2 / gzip request body / SOCKS5** – #3684 100👍, #2701 395👍 (closed 2024), #4079 151👍, #1321 128👍. Protocol gaps linger for years.
14. **OpenAPI round-trip** – import spec and *update* existing collection (#8950 55👍), export to OpenAPI (#1744 321👍, closed 2025). Bruno HN thread also asked for OpenAPI→request generation and server-variable preservation.
15. **OAuth2 polish** – auto refresh (#2452 226👍), reset token per env (Bruno #4392 28👍), custom redirect_uri (Hoppscotch #3602 27👍, #5954). Every alternative gets hammered on OAuth2.
16. **Store multiple saved request bodies / examples per request** – #9612 96👍.
17. **Disable auto-updates** – #6999 72👍/94c. Became a trust issue after Insomnia's update wiped local data and Postman's 2026 plugin auto-install (see b7).
18. **Vim bindings / keyboard-centric UI** – #12820 76👍; Bruno #2373 42👍 (3rd-highest Bruno issue).
19. **Request tags, HAR import/export, bulk-edit env vars, multi-select move/delete** – #6498 51👍, #350 163👍, #9242 47👍, #4898 42👍/96c, #1066 239👍 (closed 2022).
20. **Programmatic/secret variable handling** – set secret type via API #10580 59👍; HN/Hoppscotch #4354 "key vault support"; OS-keychain storage (Paw cited as the reference).
21. **Auth schemes enterprises need** – Kerberos #2240 80👍, AWS profiles/SSO #4209 82👍 / #11181 43👍, NTLM #1137 193👍 (closed), mTLS (Hoppscotch praised for adding it).
22. **Per-collection proxy, network emulation, Socket.io/MsgPack/JSON-RPC** – #4739 56👍, #3777 68👍, #11789 68👍, #4552 62👍, #7286 43👍.
23. **Workspace export/import** – #8163 50👍; portability is a lock-in anxiety.
24. **MCP client/server support** – appearing in 2025–26 on alternatives (Bruno #4806 26👍, Hoppscotch #5966 18👍); Postman shipped it, but in a way that backfired (b7).

## (b) Pain points to avoid

1. **Forced cloud login + data held hostage** – Scratch Pad removal; users with corporate policies forbidding credential upload simply banned the tool ("companies forbid Postman because credentials can be stored in external clouds", HN Bruno thread, ~10+ comments). Insomnia 8.0's auto-update that hid local data behind sign-in is the cautionary tale everyone retells ("compared to ransomware" – royathan.com).
2. **Credentials/secrets synced to vendor cloud** – CloudSEK 2023 finding of ~30k public workspaces leaking keys is cited repeatedly; HN demand for secrets in vaults/keychain, not synced storage.
3. **Pricing rug-pulls** – collection runner capped at 25 runs/month on free (2024); free tier cut from 3 users to 1 (Mar 2026), Team $19/user/mo, Enterprise $49; r/webdev thread "bloated, slow, expensive for what it does" 54pts/42c. Bruno is now getting the same treatment (monthly subscription, response history paywalled → "Bruno betrays"; HN comment "$50/yr steep for lowest commercial tier"). Hoppscotch criticized for declining an OIDC PR to keep it enterprise-only.
4. **Bloat / slow Electron app** – "takes a lot longer to open, even on a new machine" (HN 2024); 500MB+ RAM, 6–9s cold start claims; "dig past platform and cloud stuff to do a basic task" (HN 2022). ~20 HN comments since 2016 use the word "bloated". Yaak's ~230MB vs Bruno ~500MB measured as a selling point.
5. **UI aimed at QA/enterprise, not developers** – AI, Flows, monitors, governance crowd out the request builder; "glorified cURL interface stuffed with features to satisfy VCs" (HN, Bruno thread).
6. **Telemetry without opt-out** – daily pings (Insomnia), Restfox analytics with no opt-out called out; Yaak's "no telemetry" is a headline feature.
7. **Silent self-modifying updates** – GH #14370 (Oct 2026, 126👍 within days, no labels/response): Postman desktop auto-installed Codex/Claude Code plugins, hooks and a CLI into user dirs; users compared it to malware, several announced moves to Bruno/Insomnia.
8. **Poor communication of breaking changes** – both Scratch Pad and Insomnia changes landed as surprise auto-updates; "massive failure in communication".
9. **Ignored long-lived issues** – top requests open 7–11 years (protobuf 2017, sort 2018, reuse request 2015) while new SaaS features ship; erodes trust in the GitHub tracker.
10. **Open-core bait-and-switch** – pattern "open-source → userbase → VC → rugpull" (HN) makes people pre-emptively distrust any VC-backed client; Insomnium fork died within a year, so forks are not a safe harbour.

## (c) What people praise in alternatives

1. **Plain-text, per-request files in a folder** (Bruno `.bru`, Yaak YAML dir sync, `.http`/httpYac, Hurl) – reviewable in PRs, editable in VS Code, no UUID noise.
2. **Git as the collaboration layer** – no proprietary sync; Hoppscotch's top issue (107👍) is exactly this; Yaak 2.0's Git support headlined its HN launch (82pts).
3. **Offline-first, no account, no sign-up screen** – Bruno "no cloud account and no signup screen"; Yaak "no cloud lock-in".
4. **Lightweight non-Electron stack** – Yaak (Tauri/Rust) praised for memory and clean UI; TUIs (Posting, Slumber) and native apps (Kreya, Paw) mentioned approvingly.
5. **Postman import that just works** – repeatedly named as the thing that made switching painless (Bruno, Yaak).
6. **CLI + CI story** – Bruno CLI, Hurl, Newman-style runs with assertions, without a SaaS runner or run quotas.
7. **Scripting with real packages** – Bruno allows npm packages in scripts; request chaining (Yaak) covers much of pre/post-script need.
8. **Honest, sustainable licensing** – one-time or perpetual-fallback licenses (Yaak's JetBrains-style fallback, Bruno's original Golden one-time fee) earn goodwill; bootstrapped/no-VC is a feature.
9. **Protocol breadth** – REST, GraphQL, WebSocket, SSE, gRPC in one client (Yaak); gRPC-Web is Hoppscotch's #2 issue (102👍).
10. **Keyboard-driven UX / vim mode, fuzzy search for requests, responsive solo maintainer** – mentioned for Yaak and Bruno; vim mode is Bruno's #3 issue.
11. **Self-hosting for teams** (Hoppscotch) – wanted, but flagged that self-hosted auth (#3447 34👍) and Flatpak (#3525) are still gaps.
12. **Secrets kept local** – OS keychain (Paw), `.env` files, vault integration, OS env vars.

Summary signal: the top 3 by sheer weight are (1) local/offline/no-login with data never leaving the machine, (2) git-native plain-text files, (3) a small, fast client that does REST/GraphQL/gRPC/WS/SSE well — with predictable, non-gated pricing and no surprise updates as the trust requirements.

Sources: GH issue API queries on postmanlabs/postman-app-support, usebruno/bruno, hoppscotch/hoppscotch (reactions sorted); HN Algolia (threads 39653718, 37680126, 43185836, 42895108, 37763263, 36713830); community.postman.com/t/losing-users-after-sunsetting-scratch-pad/52618; royathan.com/blog/the-api-client-hunt; dev.to/preecha "API tooling crisis"; costbench.com Postman pricing page; github.com/orgs/postmanlabs/projects (only gRPC and WebSocket roadmap boards are public).