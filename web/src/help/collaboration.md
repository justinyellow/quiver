# Workspaces & collaboration

## Workspaces

- **My Workspace** is your personal workspace.
- **Team workspaces** are shared. Create one from the workspace switcher in the top-left, then **New team workspace**.

Switch workspaces from the same menu. Collections, environments, mocks, monitors and runs all belong to a workspace.

## Roles

| Role | Can do |
|---|---|
| Viewer | Read everything, send requests and add comments. |
| Editor | Everything a viewer can, plus create and change collections, environments, mocks and monitors. |
| Admin | Everything an editor can, plus manage members, rename or delete the workspace, and read the audit log. |

## Inviting people

Open **Workspace settings → Members**, enter an email and a role, then click **Invite**.

- If they already have an account, they are added immediately.
- Otherwise Quiver emails an invite when SMTP is configured, or shows a link you can send yourself. Links last 7 days.

## Comments

Click the speech-bubble icon on a request or collection to open the comment thread. Resolve a comment with ✓. Comments refresh every 15 seconds.

## Version history

Every save keeps a snapshot, up to the last 100 per item. Click the clock icon on a request or collection, then choose **Restore this version** on any entry. The current state is saved before restoring, so nothing is lost.

## Forks & merging

1. Fork a collection with **⋯ → Fork**. The fork remembers its source.
2. Make your changes in the fork.
3. Open the fork's **Fork changes** tab to see what was added, modified or removed compared with the source.
4. Tick changes and choose **Merge selected into source**, or **Pull all changes from source** to catch up.

> **Note:** Edits are not live-synced between people. Other people's changes appear when you reopen or refresh an item. Save often and use comments to coordinate.
