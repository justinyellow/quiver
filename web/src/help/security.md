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

If your server has single sign-on set up, the login page shows a button for each provider, such as **Continue with Google** or **Continue with Company SSO**.

- **First sign-in:** Quiver links the identity to an existing account with the same email. If no account exists, it creates one, provided your organisation allows that.
- **Several providers:** one account can have a password and several SSO identities linked. They are listed under **Single sign-on** on the account page.
- **Sign-in refused:** the login page shows the reason, for example a wrong email domain or a missing group. Ask your admin to add you to the right group, or to send an invite.

Whether SSO users can still use a password depends on server settings.
