# Mock servers

A mock server answers HTTP calls using the saved [examples](#topic:collections) in a collection. Front-end teams can build against it before the real API exists.

## Create one

1. Add examples to the requests you want to mock. The easiest way is to send the request and click **Example**.
2. Open **Mock servers** in the sidebar and click **+**, or click the server icon in a collection tab.
3. Pick the collection, name the mock, and save it.
4. Copy the **Mock URL**:

```
http://your-quiver/mock/<id>
```

Point your app's base URL at it.

## How matching works

- The incoming method and path are compared with each example's request URL. The host and a leading `{{baseUrl}}` are ignored.
- Path segments such as `:id` or `{id}` match any value.
- If several examples match, send `x-mock-response-name: <example name>` or `x-mock-response-code: 404` to pick one.
- When nothing matches, the mock returns a 404 that names the path it could not match.

## Dynamic bodies

Example bodies and header values can use:

- Path parameters by name, for example `{{id}}`
- Query parameters, for example `{{query.page}}`
- Dynamic variables, for example `{{$guid}}` or `{{$timestamp}}`

## Options

- **Response delay** simulates a slow network.
- **Require x-mock-key** makes the mock private. Quiver shows the key once, and callers send it as the `x-mock-key` header or a `?key=` parameter. **Rotate key** issues a new key.
- **Request log** lists recent calls and the status returned.

> **Tip:** Changes to examples reach the mock within about 10 seconds.
