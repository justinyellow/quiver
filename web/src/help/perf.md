# Performance tests

Generate load against an API with a number of virtual users and get latency percentiles.

## Run one

1. Open the [runner](#topic:runner) for a collection and switch to **Performance**.
2. Set **Virtual users** (up to 200), **Duration** in seconds, and optional **Ramp-up** seconds.
3. Select the requests to include.
4. Click **Start load test**. A results tab opens.

Each virtual user loops through the selected requests until the duration ends. Ramp-up starts users gradually instead of all at once.

## Results

- Overall: total requests, requests per second, error count and rate, and average, p50, p90, p95 and p99 latency.
- A per-second throughput chart, with errors shown in red.
- A per-request table with count, errors, requests per second and min, average, percentile and max latencies.

A request counts as an error when it fails to send, returns 4xx or 5xx, or fails a test.

> **Caution:** Load comes from the Quiver server itself. Point tests at staging, tell the API owner first, and remember that server CPU can become the bottleneck at high user counts.
