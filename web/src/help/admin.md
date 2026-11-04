# Instance administration

Instance admins see **Instance admin** in the account menu. The first account ever created is an admin.

## Users

- **Invite**: creates a sign-up link, and emails it when SMTP is set up.
- **Role**: promote a user to admin or demote them back to user.
- **Disable**: blocks sign-in and ends that user's sessions immediately.
- **Reset pw**: creates a 24-hour reset link.
- **Delete**: removes the user and their personal workspace.

Pending invites are listed and can be revoked.

## Settings

| Setting | Effect |
|---|---|
| Allow self-signup | When off, accounts are invite-only. Off is the default. |
| Allow private networks | Lets requests reach 10.x, 172.16–31.x and 192.168.x addresses, for internal APIs. |
| Allow localhost / loopback | Lets requests reach 127.0.0.1 on the Quiver server itself. Leave this off in production. |
| Blocked hosts | Hostnames requests may never reach. Wildcards like `*.corp.example.com` work. |
| Outbound proxy | Routes every request through an HTTP proxy. |
| History retention | Days to keep request history. |

Cloud metadata and link-local addresses (`169.254.0.0/16`) are always blocked, so requests cannot be used to steal server credentials.

## Audit log

This is an instance-wide record of sign-ins, failed sign-ins, exports, secret reveals, member and role changes, deletions and settings changes. Each workspace admin also sees their own workspace's log under **Workspace settings → Audit log**.

## Server configuration

Secrets, SMTP, OIDC, the base URL and limits are set with environment variables. See `.env.example` in the repository.
