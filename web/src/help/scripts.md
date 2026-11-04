# Scripts & tests

Scripts are JavaScript that runs before a request is sent (**pre-request**) and after the response arrives (**post-response**). They use the same `pm.*` API as Postman, so most existing Postman scripts work unchanged.

Scripts run in an isolated WebAssembly sandbox on the server. Each script has a 5-second time limit and a 64 MB memory limit, and it cannot reach the server's files or network except through `pm.sendRequest`.

## Where scripts run

You can add scripts to a collection, a folder and a request. For each send they run in this order: collection, then folders from the outermost in, then the request. Pre-request and post-response scripts both follow that order.

## Writing tests

```js
pm.test("Status is 200", () => pm.response.to.have.status(200));

pm.test("Returns the user", () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property("id");
  pm.expect(json.email).to.match(/@/);
});

pm.test("Matches schema", () => pm.response.to.have.jsonSchema({
  type: "object", required: ["id"], properties: { id: { type: "string" } }
}));
```

Results appear on the response's **Tests** tab and in runner reports. The snippet list beside the editor inserts common patterns.

## Useful API

| Call | Use |
|---|---|
| `pm.response.json()`, `.text()`, `.code`, `.responseTime`, `.headers.get(name)` | Read the response. |
| `pm.response.to.have.status(n)`, `.to.be.ok`, `.to.have.header(k)`, `.to.have.jsonBody(path, value)` | Response assertions. |
| `pm.expect(x).to.equal / eql / include / have.lengthOf / be.above / match …` | Chai-style assertions. |
| `pm.environment / globals / collectionVariables / variables .get .set .unset` | Read and write variables. |
| `pm.iterationData.get(name)` | Current data-file row. |
| `pm.request.headers.add / upsert / remove`, `pm.request.url.query.add` | Change the request in pre-request scripts. |
| `pm.sendRequest(urlOrOptions, (err, res) => …)` | Make a side request, for example to fetch a token. |
| `pm.execution.setNextRequest(name)`, `pm.execution.skipRequest()` | Control runner flow. |
| `console.log(...)` | Output to the **Console** tab. |

## Built-in modules

`require()` supports `crypto-js`, `uuid`, `lodash`, `moment`, `chai`, `ajv`, `tv4` and `xml2js`. `atob`, `btoa`, `_` and `CryptoJS` are also available as globals.

## Limitations

- Tests must be synchronous. A test that returns a promise fails.
- `setTimeout` runs its callback immediately. Use `sleep(ms)` for a real pause, up to 10 seconds.
- Other npm packages cannot be loaded.
