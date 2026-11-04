# Authorization

Set auth on the **Auth** tab of a request, folder or collection. A request set to **Inherit from parent** uses its folder's auth, then the collection's. Set auth once on the collection and every request picks it up.

Every field accepts `{{variables}}`. Keep real credentials in [secret variables](#topic:secrets) rather than typing them into the auth form.

## Types

| Type | What Quiver sends |
|---|---|
| Basic | `Authorization: Basic base64(user:pass)` |
| Bearer | `Authorization: Bearer <token>`. You can change the prefix. |
| API key | A header or query parameter with your key name and value. |
| Digest | Sends the request, reads the 401 challenge, then retries with a signed header. Supports MD5, SHA-256 and qop auth. |
| AWS Signature v4 | Signs the request with your access key, secret, region and service. A session token is optional. |
| OAuth 2.0 | See below. |

## OAuth 2.0

1. Choose a grant type: **Authorization code** (with PKCE), **Client credentials**, **Password** or **Implicit**.
2. Fill in the URLs, client ID and secret, and scope.
3. For authorization code or implicit, register this callback URL with your identity provider:

```
<your Quiver URL>/api/oauth2/callback
```

4. Click **Get new access token**. For browser-based grants a pop-up opens so you can sign in. Quiver stores the token on the request, folder or collection that owns the auth.

With **Auto-refresh** on, Quiver refreshes an expired token using the refresh token. For client credentials and password grants, it fetches a new token before sending. Refreshed tokens are saved back automatically.

> **Tip:** Put OAuth settings on the collection so every request shares one token.
