# Sending requests

The request editor is where you build and send HTTP calls. Every request lives in a tab, and each tab keeps its draft until you save or close it.

## Build a request

1. Press `Ctrl+N` or click **+** in the tab bar to open a blank request.
2. Pick the method, then type the URL. Paste a full cURL command into the URL bar and Quiver fills in the method, URL, headers, body and auth for you.
3. Fill in the sections below the URL bar:
   - **Params**: query parameters. Editing the table updates the URL and editing the URL updates the table.
   - **Auth**: see [Authorization](#topic:auth).
   - **Headers**: request headers. Use **Bulk** to paste `key:value` lines.
   - **Body**: JSON, raw text/XML/HTML, form-data with file uploads, x-www-form-urlencoded, GraphQL or a binary file. **Beautify** formats JSON.
   - **Scripts**: see [Scripts & tests](#topic:scripts).
   - **Settings**: redirects, TLS verification, cookies, timeout and response streaming.
   - **Docs**: a Markdown description that appears in generated documentation.
4. Press `Ctrl+Enter` or **Send**. Press it again while the request is running to cancel.

## Path variables

Write a path segment as `:name`, for example `/users/:userId`. Quiver replaces it with the value of a variable called `userId` from your environment, collection or globals. If no value exists, Quiver asks for one before sending.

## Variables in the URL bar

Type `{{` to get autocomplete for variables in the active environment and collection. Known variables show in green and unknown ones in red. If any variable is still unresolved when you send, a dialog lets you enter values for that one send.

## Read the response

| Tab | What it shows |
|---|---|
| Body | **Pretty** (formatted, with a JSON path filter such as `data.items[0].name`), **Raw**, or **Preview** (rendered HTML, images, PDFs). Copy and download buttons sit on the right. |
| Headers | Response headers and any redirect chain. |
| Cookies | Cookies the response set. These go into your cookie jar automatically. |
| Tests | Pass or fail for every `pm.test`, plus script errors. |
| Console | `console.log` output from scripts. |
| Timeline | The exact request sent after variables and auth were applied, plus DNS, first-byte and download timings. |

Click **Example** to save the response as an example. Examples feed [mock servers](#topic:mocks) and [documentation](#topic:docs).

## Saving

- `Ctrl+S` saves. An unsaved request asks which collection or folder to save into.
- A dot on the tab means unsaved changes.
- Turn on **Autosave** in the request header to save automatically 1.5 seconds after you stop typing.
- The **⋯** menu has **Save as**, a side-by-side or stacked layout switch, and **Reset changes**.

> **Tip:** Viewers can send requests and edit drafts but cannot save changes to shared collections.
