# Variables & environments

Variables let one collection work against local, staging and production without editing requests. Use them anywhere as `{{name}}`, including URLs, headers, bodies, auth fields and scripts.

## Scopes

When two scopes define the same name, the higher one in this list wins:

1. **Local**: set by `pm.variables.set()` in a script or typed into the unresolved-variable prompt. Lasts for one send or one run.
2. **Iteration data**: a column from a [runner](#topic:runner) data file.
3. **Environment**: the environment picked in the top-right selector.
4. **Collection**: on the collection's **Variables** tab.
5. **Globals**: shared across the whole workspace. Open them from **Environments → Globals**.

## Working with environments

1. Open the **Environments** sidebar (globe icon) and click **+**.
2. Add variables such as `baseUrl`. Set the type to **secret** for anything sensitive.
3. Save with `Ctrl+S`.
4. Choose it in the **environment selector** in the top bar, or click the dot next to its name in the sidebar.

## Layering environments

The environment selector has a **Layer on top** section. Tick extra environments to stack them over the active one, and later layers win. For example, keep `staging` as the base and layer `my-overrides` on top for personal tweaks.

## Dynamic variables

These generate a new value on every use: `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomFullName}}`, `{{$randomUUID}}`, `{{$randomBoolean}}`, `{{$randomWord}}`, `{{$randomLoremSentence}}` and about 40 more Postman-compatible names.

## Changing variables from scripts

`pm.environment.set('token', value)` in a script saves to the active environment after a single send. In the runner, changes are kept only when **Persist variable changes** is on.
