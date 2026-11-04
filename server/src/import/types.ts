import type { AuthConfig, KV, RequestBody, RequestSettings, Variable } from '../engine/types.js'

export interface ImportedExample {
  name: string
  request: { method: string; url: string; headers: KV[]; body?: RequestBody }
  status: number
  statusText: string
  headers: KV[]
  body: string
}

export interface ImportedRequest {
  name: string
  description?: string
  method: string
  url: string
  params: KV[]
  headers: KV[]
  body: RequestBody
  auth: AuthConfig
  preRequestScript?: string
  testScript?: string
  settings?: RequestSettings
  examples?: ImportedExample[]
}

export interface ImportedFolder {
  name: string
  description?: string
  auth?: AuthConfig
  preRequestScript?: string
  testScript?: string
  folders: ImportedFolder[]
  requests: ImportedRequest[]
}

export interface ImportedCollection {
  name: string
  description?: string
  auth?: AuthConfig
  variables: Variable[]
  preRequestScript?: string
  testScript?: string
  folders: ImportedFolder[]
  requests: ImportedRequest[]
}

export interface ImportResult {
  format: 'postman' | 'openapi' | 'curl' | 'har' | 'insomnia' | 'bruno' | 'swagger2' | 'quiver'
  collections: ImportedCollection[]
  environments: { name: string; variables: Variable[] }[]
}
