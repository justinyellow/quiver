// Single sign-on provider configuration, read from environment variables.
// Three provider slots can be enabled independently: google, cognito, oidc (any OpenID Connect issuer).

export type ProviderKind = 'google' | 'cognito' | 'oidc'

export interface SsoProvider {
  id: ProviderKind
  label: string
  issuer: string
  clientId: string
  clientSecret?: string
  scopes: string
  /** Extra params added to the authorization request (e.g. Google `hd`, Cognito `identity_provider`). */
  authParams: Record<string, string>
  /** Lower-cased email domains allowed to sign in. Empty = no domain restriction. */
  allowedDomains: string[]
  /** Claim holding group names (`cognito:groups` for Cognito, `groups` for most OIDC providers). */
  groupsClaim: string
  /** User must be in at least one of these groups. Empty = no group restriction. */
  requiredGroups: string[]
  /** Members of these groups become instance admins; others are set to user on each login. Empty = roles managed in Quiver. */
  adminGroups: string[]
  /** Create an account on first sign-in. Only honoured when a domain or group restriction is configured. */
  autoProvision: boolean
  /** Accept the email claim without email_verified=true (only for issuers you control). */
  trustEmail: boolean
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v === 'true')

function common(prefix: string, defaults: { groupsClaim: string; trustEmail: boolean }) {
  const e = process.env
  return {
    allowedDomains: list(e[`${prefix}_ALLOWED_DOMAINS`]).map((d) => d.toLowerCase().replace(/^@/, '')),
    groupsClaim: e[`${prefix}_GROUPS_CLAIM`] || defaults.groupsClaim,
    requiredGroups: list(e[`${prefix}_REQUIRED_GROUPS`]),
    adminGroups: list(e[`${prefix}_ADMIN_GROUPS`]),
    autoProvision: bool(e[`${prefix}_AUTO_PROVISION`], true),
    trustEmail: bool(e[`${prefix}_TRUST_EMAIL`], defaults.trustEmail),
  }
}

export function loadProviders(): SsoProvider[] {
  const e = process.env
  const out: SsoProvider[] = []

  if (e.GOOGLE_CLIENT_ID) {
    const c = common('GOOGLE', { groupsClaim: 'groups', trustEmail: false })
    out.push({
      id: 'google', label: e.GOOGLE_LABEL || 'Google', issuer: 'https://accounts.google.com',
      clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET || undefined, scopes: 'openid email profile',
      // `hd` pre-selects the Workspace account; it is a UI hint only, the domain is re-checked on callback.
      authParams: { ...(c.allowedDomains.length === 1 ? { hd: c.allowedDomains[0] } : {}), prompt: 'select_account' },
      ...c,
    })
  }

  const cognitoIssuer = e.COGNITO_ISSUER || (e.COGNITO_REGION && e.COGNITO_USER_POOL_ID ? `https://cognito-idp.${e.COGNITO_REGION}.amazonaws.com/${e.COGNITO_USER_POOL_ID}` : '')
  if (cognitoIssuer && e.COGNITO_CLIENT_ID) {
    // Cognito user pools are administered by you, and federated identities arrive with the IdP's email;
    // email_verified is often absent for federated users, so trust the pool's email by default.
    const c = common('COGNITO', { groupsClaim: 'cognito:groups', trustEmail: true })
    out.push({
      id: 'cognito', label: e.COGNITO_LABEL || 'AWS Cognito', issuer: cognitoIssuer,
      clientId: e.COGNITO_CLIENT_ID, clientSecret: e.COGNITO_CLIENT_SECRET || undefined, scopes: e.COGNITO_SCOPES || 'openid email profile',
      // Skip the hosted UI and go straight to a federated IdP such as Google when set.
      authParams: e.COGNITO_IDENTITY_PROVIDER ? { identity_provider: e.COGNITO_IDENTITY_PROVIDER } : {},
      ...c,
    })
  }

  if (e.OIDC_ISSUER && e.OIDC_CLIENT_ID) {
    const c = common('OIDC', { groupsClaim: 'groups', trustEmail: false })
    out.push({
      id: 'oidc', label: e.OIDC_LABEL || 'SSO', issuer: e.OIDC_ISSUER,
      clientId: e.OIDC_CLIENT_ID, clientSecret: e.OIDC_CLIENT_SECRET || undefined, scopes: e.OIDC_SCOPES || 'openid email profile',
      authParams: {}, ...c,
    })
  }
  return out
}

export const passwordLoginEnabled = () => process.env.AUTH_PASSWORD_LOGIN !== 'false'
export const ssoDefaultWorkspace = () => ({ name: process.env.SSO_DEFAULT_WORKSPACE || '', role: (process.env.SSO_DEFAULT_WORKSPACE_ROLE || 'editor') as 'admin' | 'editor' | 'viewer' })

// ---- sign-in policy (pure, unit-tested) ----

export interface LoginDecision { ok: true; email: string; name: string; groups: string[]; isAdmin: boolean | null; mayProvision: boolean } 
export interface LoginDenied { ok: false; reason: string }

export function evaluateClaims(p: SsoProvider, claims: Record<string, any>): LoginDecision | LoginDenied {
  const email = String(claims.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { ok: false, reason: `${p.label} did not return an email address. Add the "email" scope/attribute mapping.` }
  const verified = claims.email_verified === true || claims.email_verified === 'true'
  if (!verified && !p.trustEmail) return { ok: false, reason: `${p.label} reports this email address as unverified.` }
  const domain = email.split('@').pop()!
  if (p.allowedDomains.length && !p.allowedDomains.includes(domain)) return { ok: false, reason: `Accounts from ${domain} are not allowed to sign in.` }
  // Google Workspace sets `hd`; personal Gmail never does. Require it when restricting Google by domain.
  if (p.id === 'google' && p.allowedDomains.length && !p.allowedDomains.includes(String(claims.hd ?? '').toLowerCase())) return { ok: false, reason: 'Sign in with your organisation Google Workspace account.' }
  const raw = claims[p.groupsClaim]
  const groups: string[] = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[,\s]+/).filter(Boolean) : []
  if (p.requiredGroups.length && !groups.some((g) => p.requiredGroups.includes(g))) return { ok: false, reason: `Your account is not in a group that can use Quiver (${p.requiredGroups.join(', ')}).` }
  const isAdmin = p.adminGroups.length ? groups.some((g) => p.adminGroups.includes(g)) : null
  const restricted = p.allowedDomains.length > 0 || p.requiredGroups.length > 0
  const name = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.preferred_username || email.split('@')[0])
  return { ok: true, email, name, groups, isAdmin, mayProvision: p.autoProvision && restricted }
}
