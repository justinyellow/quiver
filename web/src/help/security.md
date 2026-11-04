# Account security

Open the account menu (top-right) → **Account & API tokens**.

## Password

Passwords must be at least 10 characters and are stored as Argon2id hashes. Changing your password signs out your other sessions.

## Two-factor authentication

1. Click **Set up 2FA**.
2. Add the shown secret to an authenticator app such as 1Password, Google Authenticator or Authy.
3. Enter the 6-digit code and click **Verify & enable**.

After that, sign-in asks for a code. Disabling 2FA requires your password.

## Sessions

The list shows every signed-in browser with its IP address and user agent. **Revoke** signs one out. Sessions expire after 7 days by default.

## Single sign-on

When the server has OIDC configured, the login page shows a **Continue with SSO** button. Accounts are matched by email or created on first login, depending on server settings.
