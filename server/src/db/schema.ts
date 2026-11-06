export const migrations: string[] = [
  `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
    totp_secret TEXT,                  -- encrypted
    totp_enabled BOOLEAN NOT NULL DEFAULT false,
    disabled BOOLEAN NOT NULL DEFAULT false,
    oidc_subject TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  );

  CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    ip TEXT,
    user_agent TEXT,
    mfa_pending BOOLEAN NOT NULL DEFAULT false
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
  );

  CREATE TABLE invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'user',
    workspace_id UUID,
    workspace_role TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ
  );

  CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'team', -- 'team' | 'personal'
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor', -- 'admin' | 'editor' | 'viewer'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    auth JSONB NOT NULL DEFAULT '{"type":"none"}',
    variables JSONB NOT NULL DEFAULT '[]',
    pre_request_script TEXT NOT NULL DEFAULT '',
    test_script TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    doc_public BOOLEAN NOT NULL DEFAULT false,
    doc_slug TEXT UNIQUE,
    forked_from UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
  );
  CREATE INDEX collections_ws ON collections(workspace_id);

  CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    auth JSONB NOT NULL DEFAULT '{"type":"inherit"}',
    pre_request_script TEXT NOT NULL DEFAULT '',
    test_script TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX folders_coll ON folders(collection_id);

  CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL DEFAULT '',
    params JSONB NOT NULL DEFAULT '[]',
    headers JSONB NOT NULL DEFAULT '[]',
    body JSONB NOT NULL DEFAULT '{"mode":"none"}',
    auth JSONB NOT NULL DEFAULT '{"type":"inherit"}',
    pre_request_script TEXT NOT NULL DEFAULT '',
    test_script TEXT NOT NULL DEFAULT '',
    settings JSONB NOT NULL DEFAULT '{}',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
  );
  CREATE INDEX requests_coll ON requests(collection_id);
  CREATE INDEX requests_folder ON requests(folder_id);

  CREATE TABLE examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    request JSONB NOT NULL DEFAULT '{}',   -- {method,url,params,headers,body}
    status INT NOT NULL DEFAULT 200,
    status_text TEXT NOT NULL DEFAULT 'OK',
    headers JSONB NOT NULL DEFAULT '[]',
    body TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX examples_req ON examples(request_id);

  CREATE TABLE environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_global BOOLEAN NOT NULL DEFAULT false,
    variables JSONB NOT NULL DEFAULT '[]', -- [{key,value,type:'default'|'secret',enabled}]  secret values encrypted
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX environments_ws ON environments(workspace_id);

  CREATE TABLE history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    status INT,
    duration_ms INT,
    size_bytes INT,
    request JSONB NOT NULL,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX history_ws_user ON history(workspace_id, user_id, created_at DESC);

  CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
    collection_name TEXT NOT NULL DEFAULT '',
    environment_id UUID,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    monitor_id UUID,
    source TEXT NOT NULL DEFAULT 'manual', -- manual | monitor | api | perf
    status TEXT NOT NULL DEFAULT 'running', -- running | passed | failed | error | cancelled
    config JSONB NOT NULL DEFAULT '{}',
    summary JSONB NOT NULL DEFAULT '{}',
    results JSONB NOT NULL DEFAULT '[]',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  );
  CREATE INDEX runs_ws ON runs(workspace_id, started_at DESC);

  CREATE TABLE monitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL DEFAULT '*/15 * * * *',
    enabled BOOLEAN NOT NULL DEFAULT true,
    notify JSONB NOT NULL DEFAULT '{}',     -- {webhookUrl, emails:[], onFailureOnly:true}
    last_run_id UUID,
    last_status TEXT,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE mocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    delay_ms INT NOT NULL DEFAULT 0,
    key_hash TEXT,               -- when set, requests need x-mock-key / ?key=
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE mock_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_id UUID NOT NULL REFERENCES mocks(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    matched_example_id UUID,
    status INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX mock_logs_mock ON mock_logs(mock_id, created_at DESC);

  CREATE TABLE revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL, -- request | collection | folder | environment
    entity_id UUID NOT NULL,
    data JSONB NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX revisions_entity ON revisions(entity_type, entity_id, created_at DESC);

  CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX comments_entity ON comments(entity_type, entity_id, created_at);

  CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID,
    user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    meta JSONB NOT NULL DEFAULT '{}',
    ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX audit_ws ON audit_log(workspace_id, created_at DESC);

  CREATE TABLE cookie_jars (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cookies JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  `
  CREATE TABLE user_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    groups JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    PRIMARY KEY (provider, subject)
  );
  CREATE INDEX user_identities_user ON user_identities(user_id);
  INSERT INTO user_identities (provider, subject, user_id, email) SELECT 'oidc', oidc_subject, id, email FROM users WHERE oidc_subject IS NOT NULL;
  ALTER TABLE users DROP COLUMN oidc_subject;
  `,
]
