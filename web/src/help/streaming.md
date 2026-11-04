# Streaming & Server-Sent Events

Some APIs send their response in pieces, such as Server-Sent Events, LLM token streams or long-polling feeds. Quiver can show those pieces as they arrive instead of waiting for the end.

1. Open the request's **Settings** tab.
2. Turn on **Stream response**.
3. Send the request. The body fills in live, and tests run once the stream closes.

Cancel with the same button you used to send.

> **Tip:** For an endless stream, cancel when you have seen enough. The response size limit still applies.
