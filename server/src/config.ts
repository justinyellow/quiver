import crypto from 'node:crypto'

function env(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing required env var ${name}`)
  }
  return v
}

const isProd = process.env.NODE_ENV === 'production'

// In dev we generate ephemeral keys so `npm run dev` works with zero setup.
// In production both must be set explicitly (see .env.example).
function keyOrDev(name: string): string {
  const v = process.env[name]
  if (v && v.length >= 32) return v
  if (isProd) throw new Error(`${name} must be set to a random string of at least 32 chars in production`)
  return crypto.createHash('sha256').update(`dev-${name}`).digest('hex')
}

export const config = {
  isProd,
  port: Number(env('PORT', '4000')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgres://quiver:quiver@localhost:5440/quiver'),
  // Public base URL of this deployment (used for OIDC callbacks, docs/mocks links, emails)
  baseUrl: env('BASE_URL', 'http://localhost:5173'),
  sessionSecret: keyOrDev('SESSION_SECRET'),
  encryptionKey: keyOrDev('ENCRYPTION_KEY'),
  allowSignup: env('ALLOW_SIGNUP', 'false') === 'true',
  sessionTtlHours: Number(env('SESSION_TTL_HOURS', '168')),
  // Outbound request guard. Self-hosted teams usually want to hit internal APIs,
  // so RFC1918 is allowed by default; cloud metadata + loopback stay blocked
  // unless explicitly allowed.
  allowPrivateTargets: env('ALLOW_PRIVATE_TARGETS', 'true') === 'true',
  allowLoopbackTargets: env('ALLOW_LOOPBACK_TARGETS', 'false') === 'true',
  blockedHosts: env('BLOCKED_HOSTS', '').split(',').map((s) => s.trim()).filter(Boolean),
  maxResponseBytes: Number(env('MAX_RESPONSE_BYTES', String(50 * 1024 * 1024))),
  requestTimeoutMs: Number(env('REQUEST_TIMEOUT_MS', '60000')),
  scriptTimeoutMs: Number(env('SCRIPT_TIMEOUT_MS', '5000')),
  scriptMemoryMb: Number(env('SCRIPT_MEMORY_MB', '64')),
  smtp: {
    url: process.env.SMTP_URL || '',
    from: process.env.SMTP_FROM || 'quiver@localhost',
  },
  oidc: {
    issuer: process.env.OIDC_ISSUER || '',
    clientId: process.env.OIDC_CLIENT_ID || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    // 'oidc' users are auto-provisioned on first login when true
    autoProvision: env('OIDC_AUTO_PROVISION', 'true') === 'true',
  },
  trustProxy: env('TRUST_PROXY', 'false') === 'true',
  // Local development convenience: auto sign-in on localhost. Never active when NODE_ENV=production.
  devAutoLogin: !isProd && env('DEV_AUTO_LOGIN', 'true') === 'true',
  devAutoLoginEmail: process.env.DEV_AUTO_LOGIN_EMAIL || '',
  logLevel: env('LOG_LEVEL', isProd ? 'info' : 'debug'),
}
