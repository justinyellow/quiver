# Import & export

## Import

Open the import dialog from the **upload icon** in the Collections sidebar, **Import** on the welcome screen, or the command palette. Then do one of the following:

- Drop or choose files. For a Bruno collection, select every file in the folder.
- Paste JSON, YAML or a cURL command.
- Switch to **From URL** and enter a spec URL.

The format is detected automatically, and a preview shows what Quiver found.

| Format | Notes |
|---|---|
| Postman collection v2.0 / v2.1 | Folders, auth, scripts, variables and examples. |
| Postman environment, globals, "export all" dump | Secret types are kept. |
| OpenAPI 3.x, Swagger 2.0 (JSON or YAML) | Folders by tag, a `baseUrl` variable, example bodies built from schemas, and security schemes mapped to auth. |
| cURL | One or more commands. |
| HAR | Requests grouped by host, with responses saved as examples. |
| Insomnia v4 | Requests, folders and environments. |
| Bruno | `.bru` files, including environments. |
| Quiver JSON | Full round trip. |

> **Tip:** Pasting a cURL command straight into a request's URL bar fills in that request.

## Export

Use **⋯** on a collection in the sidebar, or the collection's **Export & publish** tab:

- **Postman v2.1**, for Postman or Newman.
- **OpenAPI 3.0**, a spec generated from your requests and examples.
- **Quiver JSON**, a lossless export.
- **Plain-text folder**, a zip with one YAML file per request. Commit it to git to review API changes in pull requests.

For a whole workspace, go to **Workspace settings → General → Export**. Secrets are blanked unless an admin exports them explicitly.
