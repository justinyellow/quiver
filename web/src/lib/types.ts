export interface KV { key: string; value: string; enabled?: boolean; description?: string; type?: 'text' | 'file'; src?: string }
export type BodyMode = 'none' | 'raw' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'formdata' | 'urlencoded' | 'graphql' | 'binary'
export interface RequestBody { mode: BodyMode; raw?: string; language?: 'json' | 'xml' | 'text' | 'html' | 'javascript'; formdata?: KV[]; urlencoded?: KV[]; graphql?: { query: string; variables?: string; operationName?: string }; binary?: { name: string; contentType?: string; data: string } }
export interface AuthConfig { type: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'oauth2' | 'awsv4'; basic?: any; bearer?: any; apikey?: any; digest?: any; oauth2?: any; awsv4?: any }
export interface RequestSettings { followRedirects?: boolean; maxRedirects?: number; verifyTls?: boolean; timeoutMs?: number; sendCookies?: boolean; stream?: boolean }
export interface RequestDef { id?: string; name: string; method: string; url: string; params: KV[]; headers: KV[]; body: RequestBody; auth: AuthConfig; preRequestScript?: string; testScript?: string; settings?: RequestSettings; description?: string }
export interface Variable { key: string; value: string; type?: 'default' | 'secret'; enabled?: boolean; masked?: boolean }
export interface ResponseInfo { status: number; statusText: string; headers: [string, string][]; body: string; isBase64: boolean; contentType: string; size: number; timeMs: number; timings?: any; redirects?: { url: string; status: number }[]; cookies?: any[]; truncated?: boolean }
export interface TestResult { name: string; passed: boolean; error?: string; skipped?: boolean }
export interface ConsoleEntry { level: string; args: any[]; ts: number }
export interface ExecResult { request: { method: string; url: string; headers: Record<string, string>; body?: string }; response?: ResponseInfo; error?: string; tests: TestResult[]; console: ConsoleEntry[]; scriptErrors: string[]; varMutations: any; skipped?: boolean; totalMs?: number }
export interface User { id: string; email: string; name: string; role: 'admin' | 'user'; totp_enabled: boolean }
export interface Workspace { id: string; name: string; type: 'team' | 'personal'; role: 'admin' | 'editor' | 'viewer' }
export interface TreeData { collections: any[]; folders: any[]; requests: any[]; examples: any[] }
export type TabType = 'request' | 'collection' | 'folder' | 'environment' | 'runner' | 'run' | 'mock' | 'monitor' | 'ws' | 'docs' | 'perf' | 'example' | 'history' | 'cookies' | 'settings' | 'help'
export interface Tab { id: string; type: TabType; entityId?: string; title: string; draft?: any; dirty?: boolean; meta?: any }
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
export const emptyRequest = (): RequestDef => ({ name: 'Untitled Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, auth: { type: 'inherit' }, preRequestScript: '', testScript: '', settings: {} })
