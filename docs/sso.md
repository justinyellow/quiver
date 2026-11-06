# Single sign-on

Quiver can sign people in with **Google**, **AWS Cognito**, or **any OpenID Connect provider** (Keycloak, Authelia, Entra ID, Okta, Auth0, Authentik…). The three slots are independent and can all be enabled at once. Each one shows as a button on the login page.

Everything is configured with environment variables. Restart the server after changing them.

## Redirect URIs

Register this callback with your provider, replacing `<id>` with `google`, `cognito` or `oidc`:

```
<BASE_URL>/api/auth/sso/<id>/callback
```

`BASE_URL` must be the URL people open in the browser, for example `https://quiver.example.com`.

## Who is allowed in

Every provider supports the same access rules. Each prefix is `GOOGLE_`, `COGNITO_` or `OIDC_`.

| Variable | Effect |
|---|---|
| `<P>_ALLOWED_DOMAINS` | Comma-separated email domains. Other domains are rejected. |
| `<P>_REQUIRED_GROUPS` | The user must be in at least one of these groups. Read from `<P>_GROUPS_CLAIM`. |
| `<P>_ADMIN_GROUPS` | Members become Quiver instance admins, and everyone else is set to *user*, on every sign-in. Leave empty to manage roles in Quiver. The last admin is never demoted. |
| `<P>_GROUPS_CLAIM` | ID-token claim holding groups. Defaults to `cognito:groups` for Cognito and `groups` otherwise. |
| `<P>_AUTO_PROVISION` | Create accounts on first sign-in. Defaults to `true`. |
| `<P>_TRUST_EMAIL` | Accept the email without `email_verified=true`. Defaults to `true` for Cognito and `false` otherwise. |

**Safe default:** Quiver only creates accounts automatically when an allowed-domain or required-group rule is set. Without one, only people who already have a Quiver account, for example through an invite, can sign in with SSO.

**Account linking:** the first time someone signs in with a provider, Quiver links that identity to the existing account with the same email, if there is one. The email must be verified or trusted. One person can have Google, Cognito and a password linked to a single account.

## Google

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
2. Add the redirect URI `<BASE_URL>/api/auth/sso/google/callback`.
3. For a company-only setup, set the OAuth consent screen's user type to **Internal**. Then only your Workspace accounts can complete sign-in.

```bash
GOOGLE_CLIENT_ID=1234.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_ALLOWED_DOMAINS=example.com      # checked against both the email and Google's hd (Workspace) claim
GOOGLE_LABEL=Google
```

Personal Gmail accounts never carry a Workspace `hd` claim, so they are rejected whenever `GOOGLE_ALLOWED_DOMAINS` is set.

## AWS Cognito

Use this when your organisation already runs a Cognito user pool. It is the right choice if Google sign-in, MFA and groups are managed centrally there.

1. Create an **app client** in the user pool:
   - Allowed OAuth flow: **Authorization code grant**
   - Scopes: `openid`, `email`, `profile`
   - Callback URL: `<BASE_URL>/api/auth/sso/cognito/callback`
   - Identity providers: the ones staff should use, for example your Google federation and/or Cognito username-password
   - A client secret is optional. Without one, Quiver uses PKCE as a public client.
2. Make sure the pool has a **domain** (hosted UI). Quiver discovers the endpoints from the issuer.
3. Create groups for Quiver access and add people to them.

```bash
COGNITO_REGION=eu-west-1
COGNITO_USER_POOL_ID=eu-west-1_AbCdEf123     # or COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<pool-id>
COGNITO_CLIENT_ID=...
COGNITO_CLIENT_SECRET=                        # only if the app client has a secret
COGNITO_IDENTITY_PROVIDER=Google              # optional: skip the hosted UI and go straight to this federated IdP
COGNITO_REQUIRED_GROUPS=quiver-users,quiver-admins
COGNITO_ADMIN_GROUPS=quiver-admins
COGNITO_ALLOWED_DOMAINS=example.com           # optional extra guard
COGNITO_LABEL=Company SSO
```

> **Shared user pools:** if the pool also holds users for other apps, including customers, always set `COGNITO_REQUIRED_GROUPS`. Cognito sign-up triggers only run when a user is first created, so a user who exists for another app could otherwise sign in to Quiver too.

Signing out of Quiver does not sign the user out of Cognito's hosted UI session.

## Generic OpenID Connect

```bash
OIDC_ISSUER=https://auth.example.com          # must serve /.well-known/openid-configuration
OIDC_CLIENT_ID=quiver
OIDC_CLIENT_SECRET=...
OIDC_LABEL=Company SSO
OIDC_ALLOWED_DOMAINS=example.com
OIDC_GROUPS_CLAIM=groups
OIDC_REQUIRED_GROUPS=quiver
OIDC_ADMIN_GROUPS=quiver-admins
```

## Options that apply to all providers

```bash
SSO_DEFAULT_WORKSPACE=Engineering             # new SSO users join this team workspace (created if missing)
SSO_DEFAULT_WORKSPACE_ROLE=editor             # viewer | editor | admin
AUTH_PASSWORD_LOGIN=false                     # SSO only: hide and reject email/password sign-in
```

With `AUTH_PASSWORD_LOGIN=false`, the very first account can still be created with a password during setup. Make sure at least one admin can sign in with SSO before you enable it, or keep a break-glass admin on another provider.

## Troubleshooting

Failed sign-ins return to the login page with the reason, for example "Accounts from gmail.com are not allowed to sign in". They are also recorded as `user.login_failed` in the audit log. Admins can review the configured providers under **Instance admin → Settings**.
