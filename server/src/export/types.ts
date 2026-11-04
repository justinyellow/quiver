import type { AuthConfig, KV, RequestBody, RequestSettings, Variable } from '../engine/types.js'

// Full in-memory representation of a collection as stored in Quiver, used by exporters.
export interface ExportExample { id: string; name: string; request: { method: string; url: string; headers?: KV[]; body?: RequestBody; params?: KV[] }; status: number; statusText: string; headers: KV[]; body: string }
export interface ExportRequest { id: string; name: string; description: string; method: string; url: string; params: KV[]; headers: KV[]; body: RequestBody; auth: AuthConfig; preRequestScript: string; testScript: string; settings: RequestSettings; examples: ExportExample[] }
export interface ExportFolder { id: string; name: string; description: string; auth: AuthConfig; preRequestScript: string; testScript: string; folders: ExportFolder[]; requests: ExportRequest[] }
export interface ExportCollection { id: string; name: string; description: string; auth: AuthConfig; variables: Variable[]; preRequestScript: string; testScript: string; folders: ExportFolder[]; requests: ExportRequest[] }
export interface ExportEnvironment { id: string; name: string; variables: Variable[] }
