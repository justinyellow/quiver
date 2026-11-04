# WebSocket client

Connect to WebSocket APIs, send messages and watch the stream.

1. Open a new WebSocket tab from the welcome screen or with `Ctrl+K` → *New WebSocket connection*.
2. Enter a `ws://` or `wss://` URL.
3. Add any handshake headers, such as `Authorization`, on the **Headers** tab.
4. Click **Connect**.
5. Type a message and press **Send** or `Ctrl+Enter`.

The **Messages** panel shows incoming messages (↓), sent messages (↑) and connection events, with timestamps. JSON messages are formatted automatically.

> **How it connects:** The connection goes through the Quiver server. This lets you set custom headers, which browsers cannot do directly. The server's outbound network rules decide which hosts you can reach.
