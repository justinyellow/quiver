import { FolderTree, Send, KeyRound, Globe, Lock, FileCode2, Play, Server, Activity, Gauge, BookOpen, ArrowLeftRight, Code2, Radio, Waves, History, Users, TerminalSquare, ShieldCheck, Shield, Keyboard, type LucideIcon } from 'lucide-react'
import { useStore } from '@/store'

const pages = import.meta.glob('../help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const helpContent = (id: string) => pages[`../help/${id}.md`] ?? ''

export type HelpCategory = 'Build' | 'Test & automate' | 'Mock & publish' | 'Collaborate' | 'Administer' | 'Reference'

export interface HelpAction { label: string; run: () => void }
export interface HelpTopic { id: string; title: string; summary: string; category: HelpCategory; icon: LucideIcon; related?: string[]; action?: HelpAction }

const s = () => useStore.getState()
const newRequest = () => s().openTab({ type: 'request', title: 'Untitled Request', draft: null, dirty: false })
const sidebar = (tab: string) => () => s().setSidebarTab(tab)

export const TOPICS: HelpTopic[] = [
  { id: 'requests', title: 'Sending requests', category: 'Build', icon: Send, summary: 'Build HTTP requests with params, headers, bodies and path variables, and read responses.', related: ['auth', 'variables', 'scripts', 'codegen'], action: { label: 'New request', run: newRequest } },
  { id: 'auth', title: 'Authorization', category: 'Build', icon: KeyRound, summary: 'Basic, bearer, API key, digest, AWS SigV4 and OAuth 2.0 with PKCE and auto-refresh, inherited down the tree.', related: ['secrets', 'collections'] },
  { id: 'variables', title: 'Variables & environments', category: 'Build', icon: Globe, summary: 'Globals, collection and environment scopes, layered environments and dynamic values.', related: ['secrets', 'scripts', 'runner'], action: { label: 'Open environments', run: sidebar('environments') } },
  { id: 'secrets', title: 'Secrets', category: 'Build', icon: Lock, summary: 'Encrypted, masked, audited variables that never leave in exports or public docs.', related: ['variables', 'admin'] },
  { id: 'scripts', title: 'Scripts & tests', category: 'Build', icon: FileCode2, summary: 'Postman-compatible pm.* scripting in a sandbox: assertions, chaining and request changes.', related: ['runner', 'variables'] },
  { id: 'collections', title: 'Collections, folders & examples', category: 'Build', icon: FolderTree, summary: 'Organise requests, share auth and scripts, and save example responses.', related: ['docs', 'mocks', 'collaboration'], action: { label: 'Open collections', run: sidebar('collections') } },
  { id: 'codegen', title: 'Code generation', category: 'Build', icon: Code2, summary: 'Copy any request as code in 24 languages and tools.', related: ['requests', 'docs'] },
  { id: 'websocket', title: 'WebSocket client', category: 'Build', icon: Radio, summary: 'Connect with custom headers, send messages and watch the stream.', action: { label: 'New WebSocket', run: () => s().openTab({ type: 'ws', title: 'WebSocket', id: 'ws-' + Date.now() }) } },
  { id: 'streaming', title: 'Streaming & SSE', category: 'Build', icon: Waves, summary: 'See Server-Sent Events and chunked responses as they arrive.', related: ['requests'] },
  { id: 'runner', title: 'Collection runner', category: 'Test & automate', icon: Play, summary: 'Run collections with iterations, CSV/JSON data, branching and JUnit reports.', related: ['scripts', 'ci', 'perf'], action: { label: 'Open runs', run: sidebar('runs') } },
  { id: 'monitors', title: 'Monitors', category: 'Test & automate', icon: Activity, summary: 'Scheduled runs with Slack, webhook or email alerts and uptime history.', related: ['runner'], action: { label: 'New monitor', run: () => s().openTab({ type: 'monitor', entityId: 'new', title: 'New monitor' }) } },
  { id: 'perf', title: 'Performance tests', category: 'Test & automate', icon: Gauge, summary: 'Load-test with virtual users, ramp-up, throughput and latency percentiles.', related: ['runner'] },
  { id: 'ci', title: 'CI & API tokens', category: 'Test & automate', icon: TerminalSquare, summary: 'Run collections from pipelines with API tokens, a CLI and JUnit output.', related: ['runner', 'security'], action: { label: 'Create a token', run: () => s().openTab({ type: 'settings', entityId: 'account', title: 'Account' }) } },
  { id: 'mocks', title: 'Mock servers', category: 'Mock & publish', icon: Server, summary: 'Serve saved examples at a stable URL, with path matching, delays and private keys.', related: ['collections'], action: { label: 'New mock server', run: () => s().openTab({ type: 'mock', entityId: 'new', title: 'New mock server' }) } },
  { id: 'docs', title: 'Documentation', category: 'Mock & publish', icon: BookOpen, summary: 'Generated API docs with code samples, optionally published at a public link.', related: ['collections', 'codegen'] },
  { id: 'import-export', title: 'Import & export', category: 'Mock & publish', icon: ArrowLeftRight, summary: 'Bring in Postman, OpenAPI, cURL, HAR, Insomnia or Bruno, and export to Postman, OpenAPI or git-friendly YAML.', action: { label: 'Import now', run: () => { s().setSidebarTab('collections'); window.dispatchEvent(new CustomEvent('quiver:import')) } } },
  { id: 'collaboration', title: 'Workspaces & collaboration', category: 'Collaborate', icon: Users, summary: 'Team workspaces, roles, invites, comments, version history, forks and merges.', related: ['admin'], action: { label: 'Workspace settings', run: () => s().openTab({ type: 'settings', entityId: 'workspace', title: 'Workspace settings' }) } },
  { id: 'history-cookies', title: 'History & cookies', category: 'Collaborate', icon: History, summary: 'Your private request history and the per-workspace cookie jar.', action: { label: 'Open history', run: sidebar('history') } },
  { id: 'security', title: 'Account security', category: 'Administer', icon: ShieldCheck, summary: 'Password, two-factor authentication, sessions and single sign-on.', action: { label: 'Account settings', run: () => s().openTab({ type: 'settings', entityId: 'account', title: 'Account' }) } },
  { id: 'admin', title: 'Instance administration', category: 'Administer', icon: Shield, summary: 'Users, invites, network policy, retention and the audit log.', related: ['security', 'secrets'] },
  { id: 'shortcuts', title: 'Keyboard shortcuts', category: 'Reference', icon: Keyboard, summary: 'Every shortcut in one table.' },
]
export const CATEGORIES: HelpCategory[] = ['Build', 'Test & automate', 'Mock & publish', 'Collaborate', 'Administer', 'Reference']
export const topic = (id: string) => TOPICS.find((t) => t.id === id)

export interface GuideStep { id: string; title: string; body: string; topic: string; action?: HelpAction }
export const GUIDE: GuideStep[] = [
  { id: 'import', title: 'Bring in your APIs', topic: 'import-export', body: 'Import a Postman collection, an OpenAPI spec or a cURL command, or create an empty collection. Postman exports keep their folders, scripts, auth and examples.', action: { label: 'Open import', run: () => { s().setSidebarTab('collections'); window.dispatchEvent(new CustomEvent('quiver:import')) } } },
  { id: 'env', title: 'Create an environment', topic: 'variables', body: 'Add an environment such as "Staging" with a `baseUrl` variable. Store tokens as **secret** variables so they are encrypted and masked. Select it in the top-right environment picker.', action: { label: 'New environment', run: () => s().openTab({ type: 'environment', entityId: 'new', title: 'New environment' }) } },
  { id: 'send', title: 'Send your first request', topic: 'requests', body: 'Open a request and press `Ctrl+Enter`. Look at the response body, headers and timeline. Use `{{baseUrl}}` in the URL so it follows the selected environment.', action: { label: 'New request', run: newRequest } },
  { id: 'auth', title: 'Set up auth once', topic: 'auth', body: 'Open the collection, go to **Auth**, and configure it there. Every request set to *Inherit* uses it. OAuth 2.0 tokens refresh automatically.' },
  { id: 'tests', title: 'Add tests', topic: 'scripts', body: 'On a request, open **Scripts → Post-response** and add `pm.test("Status is 200", () => pm.response.to.have.status(200));`. Results show on the **Tests** tab.' },
  { id: 'example', title: 'Save examples and spin up a mock', topic: 'mocks', body: 'After sending, click **Example** to save the response. Then create a mock server for the collection, and front-end developers get a working URL immediately.', action: { label: 'New mock server', run: () => s().openTab({ type: 'mock', entityId: 'new', title: 'New mock server' }) } },
  { id: 'run', title: 'Run the whole collection', topic: 'runner', body: 'Use **⋯ → Run collection** on the collection in the sidebar. Attach a CSV for data-driven runs, then download a JUnit report.' },
  { id: 'monitor', title: 'Schedule a monitor', topic: 'monitors', body: 'Create a monitor on a schedule like every 15 minutes, with a Slack webhook, so you hear about failures before your users do.', action: { label: 'New monitor', run: () => s().openTab({ type: 'monitor', entityId: 'new', title: 'New monitor' }) } },
  { id: 'team', title: 'Invite your team', topic: 'collaboration', body: 'Create a team workspace from the workspace switcher, move or fork collections into it, and invite colleagues as viewers, editors or admins.', action: { label: 'Workspace settings', run: () => s().openTab({ type: 'settings', entityId: 'workspace', title: 'Workspace settings' }) } },
  { id: 'ci', title: 'Wire it into CI', topic: 'ci', body: 'Create an API token and call the runner from your pipeline. The build fails when tests fail.', action: { label: 'Create a token', run: () => s().openTab({ type: 'settings', entityId: 'account', title: 'Account' }) } },
  { id: 'docs', title: 'Publish documentation', topic: 'docs', body: 'Write descriptions in Markdown, then publish a public docs link from the collection\'s **Export & publish** tab.' },
]

/** Opens (or focuses) the single Help tab at a topic: 'guide', 'features' or a topic id. */
export function openHelp(topicId = 'guide') {
  const st = useStore.getState()
  const ex = st.tabs.find((t) => t.type === 'help')
  if (ex) { st.updateTab(ex.id, { meta: { topic: topicId } }); st.setActive(ex.id) }
  else st.openTab({ type: 'help', id: 'help', title: 'Help', meta: { topic: topicId } })
}

/** Best help topic for whatever tab is active (used by F1). */
export function topicForActiveTab(): string {
  const st = useStore.getState()
  const t = st.tabs.find((x) => x.id === st.activeTab)
  if (!t) return 'guide'
  const map: Record<string, string> = { request: 'requests', collection: 'collections', folder: 'collections', environment: 'variables', runner: 'runner', run: 'runner', perf: 'perf', mock: 'mocks', monitor: 'monitors', ws: 'websocket', example: 'mocks', history: 'history-cookies', cookies: 'history-cookies' }
  if (t.type === 'settings') return t.entityId === 'account' ? 'security' : t.entityId === 'admin' ? 'admin' : 'collaboration'
  if (t.type === 'help') return t.meta?.topic ?? 'guide'
  return map[t.type] ?? 'guide'
}
