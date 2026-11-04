# CI & API tokens

## Create a token

1. Open the account menu (top-right) → **Account & API tokens**.
2. Under **API tokens**, enter a name and an optional expiry in days, then click **Create**.
3. Copy the `qv_…` token. It is shown only once.

A token acts with your permissions. Revoke it from the same page.

## Run a collection from CI

The bundled CLI starts a run, prints the results and exits with code 1 if anything failed.

```bash
export QUIVER_URL=https://quiver.example.com
export QUIVER_TOKEN=qv_xxx
npm run cli -w server -- run \
  --workspace <workspace-id> --collection <collection-id> \
  --environment <environment-id> --junit results.xml
```

Other options are `--iterations N`, `--data rows.csv` and `--folder <folder-id>`. IDs appear in the browser URL bar or via the API.

## Use the API directly

```bash
curl -X POST "$QUIVER_URL/api/workspaces/<ws>/runs?wait=true" \
  -H "Authorization: Bearer $QUIVER_TOKEN" -H "Content-Type: application/json" \
  -d '{"collectionId":"<col>","environmentId":"<env>"}'
```

The response includes `status` (`passed`, `failed` or `error`), a `summary` and `results`. Download a JUnit report from `GET /api/runs/<id>/junit`.

## GitHub Actions example

```yaml
- name: API tests
  run: npm run cli -w server -- run --workspace $WS --collection $COL --junit results.xml
  env:
    QUIVER_URL: ${{ secrets.QUIVER_URL }}
    QUIVER_TOKEN: ${{ secrets.QUIVER_TOKEN }}
```
