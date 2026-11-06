import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateClaims, type SsoProvider } from './sso-config.js'

const base = (over: Partial<SsoProvider>): SsoProvider => ({ id: 'oidc', label: 'SSO', issuer: 'x', clientId: 'c', scopes: 'openid', authParams: {}, allowedDomains: [], groupsClaim: 'groups', requiredGroups: [], adminGroups: [], autoProvision: true, trustEmail: false, ...over })

test('google workspace domain is enforced via email and hd', () => {
  const g = base({ id: 'google', label: 'Google', allowedDomains: ['example.com'] })
  assert.equal(evaluateClaims(g, { email: 'a@example.com', email_verified: true, hd: 'example.com' }).ok, true)
  assert.equal(evaluateClaims(g, { email: 'a@gmail.com', email_verified: true }).ok, false)
  // same domain in email but no hd (e.g. consumer account on custom domain) is rejected
  assert.equal(evaluateClaims(g, { email: 'a@example.com', email_verified: true }).ok, false)
})

test('unverified email rejected unless provider trusted', () => {
  assert.equal(evaluateClaims(base({}), { email: 'a@x.com' }).ok, false)
  assert.equal(evaluateClaims(base({ trustEmail: true }), { email: 'a@x.com' }).ok, true)
})

test('cognito groups gate access and map admin role', () => {
  const c = base({ id: 'cognito', groupsClaim: 'cognito:groups', trustEmail: true, requiredGroups: ['quiver@user', 'quiver@admin'], adminGroups: ['quiver@admin'] })
  const admin = evaluateClaims(c, { email: 'a@example.com', 'cognito:groups': ['quiver@admin'] })
  assert.ok(admin.ok && admin.isAdmin === true)
  const user = evaluateClaims(c, { email: 'b@example.com', 'cognito:groups': ['quiver@user', 'billing@user'] })
  assert.ok(user.ok && user.isAdmin === false)
  assert.equal(evaluateClaims(c, { email: 'c@example.com', 'cognito:groups': ['billing@user'] }).ok, false)
  assert.equal(evaluateClaims(c, { email: 'c@example.com' }).ok, false)
})

test('auto-provision only when a restriction exists', () => {
  const open = evaluateClaims(base({ trustEmail: true }), { email: 'a@x.com' })
  assert.ok(open.ok && open.mayProvision === false)
  const dom = evaluateClaims(base({ trustEmail: true, allowedDomains: ['x.com'] }), { email: 'a@x.com' })
  assert.ok(dom.ok && dom.mayProvision === true)
})
