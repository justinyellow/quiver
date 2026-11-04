# Collections, folders & examples

A collection is a group of related requests, such as one API. It can hold folders, its own variables, auth, scripts and documentation.

## Organising

- **New collection:** click **+** in the Collections sidebar.
- **Add requests and folders:** hover a collection or folder, open **⋯**, then choose **Add request** or **Add folder**.
- **Move a request:** drag it onto a folder.
- **Sort:** **⋯ → Sort A→Z (recursive)** sorts folders and requests alphabetically.
- **Duplicate, Fork, Rename, Delete** and **Export** are all in the collection **⋯** menu.
- **Filter:** the box at the top of the sidebar matches request names and URLs.

## Collection settings

Double-click a collection, or choose **Edit / docs / settings**, to open its tab:

- **Overview**: a Markdown description.
- **Auth**: default auth that requests inherit.
- **Scripts**: run before and after every request in the collection.
- **Variables**: collection-scoped variables.
- **Documentation**: a live preview of the generated docs.
- **Export & publish**: export formats and the public docs link.

Folders have the same Overview, Auth and Scripts tabs. Open them by double-clicking the folder.

## Examples

An example is a saved request and response pair.

1. Send a request.
2. Click **Example** in the response bar and give it a name, such as `200 OK` or `404 not found`.
3. The example appears under the request in the sidebar. Click the arrow to expand it, then click the example to edit its status, headers or body.

Examples power [mock servers](#topic:mocks) and appear in [documentation](#topic:docs).
