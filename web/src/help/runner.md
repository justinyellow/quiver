# Collection runner & data files

The runner sends every selected request in a collection or folder, in the order shown, and collects their test results.

## Run a collection

1. Open the runner in one of three ways: **⋯ → Run collection** in the sidebar, **Run** in the collection tab, or **Run folder** in a folder tab.
2. Choose an environment.
3. Set **Iterations** and an optional **Delay** between requests.
4. Untick any requests you want to skip.
5. Click **Run**. Results stream in live, and **Cancel** stops the run.

Click a result row to see its tests, console output and response body. **Failed only** filters the list.

## Data-driven runs

Attach a CSV or JSON file under **Data file**. There is one iteration per row or array item.

```csv
email,expectedStatus
alice@example.com,200
not-an-email,400
```

Columns become variables, so requests can use `{{email}}` and scripts can read `pm.iterationData.get("expectedStatus")`.

## Options

- **Stop on first test failure** halts the run as soon as any test or script fails.
- **Persist variable changes** saves `pm.environment.set` and similar changes back after the run. When it is off, each run starts clean.

## Branching

Call `pm.execution.setNextRequest("Request name")` in a script to jump to another request. Call `pm.execution.setNextRequest(null)` to end the current iteration.

## Reports

Every run is saved under the **Runs** sidebar. **JUnit XML** downloads a report that CI systems can read. To run from a pipeline, see [CI & API tokens](#topic:ci).
