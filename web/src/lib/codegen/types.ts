export interface KV {
  key: string
  value: string
  enabled?: boolean
  description?: string
  type?: 'text' | 'file'
  src?: string
}

export type BodyMode = 'none' | 'raw' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'formdata' | 'urlencoded' | 'graphql' | 'binary'

export interface RequestBody {
  mode: BodyMode
  raw?: string
  language?: 'json' | 'xml' | 'text' | 'html' | 'javascript'
  formdata?: KV[]
  urlencoded?: KV[]
  graphql?: { query: string; variables?: string; operationName?: string }
  binary?: { name: string; contentType?: string; data: string }
}

export interface AuthConfig {
  type: 'none' | 'inherit' | 'basic' | 'bearer' | 'apikey' | 'digest' | 'oauth2' | 'awsv4'
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
}
