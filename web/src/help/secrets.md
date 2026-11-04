# Secrets

Mark any environment, globals or collection variable as type **secret** to protect it.

## What secret means

- **Encrypted at rest** with AES-256-GCM, using the server's `ENCRYPTION_KEY`.
- **Masked** in the editor as `••••••••`.
- **Revealing is audited.** Editors can click **Reveal secrets**, and each reveal is written to the workspace audit log.
- **Blanked on export.** Environment and workspace exports leave secret values empty unless an admin chooses **Export incl. secrets**.
- **Never published.** Public documentation never includes secret variables, scripts or auth values.

## Using a secret

Reference it like any variable, for example `{{apiToken}}` in a bearer auth field. Quiver decrypts it on the server only when it sends the request.

## Editing a secret

Type a new value into the masked field and save. Leaving the mask untouched keeps the old value.

> **Important:** Back up `ENCRYPTION_KEY`. If it is lost, stored secrets cannot be decrypted.
