# Monitors

A monitor runs a collection on a schedule and alerts you when tests fail. Quiver puts no limit on how many monitors you create or how many requests they make.

## Create one

1. Open **Monitors** in the sidebar and click **+**, or click the activity icon in a collection tab.
2. Choose a collection and an environment.
3. Set the **Schedule** as a cron expression in server time, or pick a preset:

| Cron | Meaning |
|---|---|
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Hourly |
| `0 8 * * 1-5` | Weekdays at 08:00 |

4. Add alert destinations and save.

## Alerts

- **Webhook URL** receives a JSON POST with the monitor, run link, summary and failing requests. A Slack, Teams or Discord incoming webhook works here.
- **Email recipients** get a plain-text summary. This needs `SMTP_URL` configured on the server.
- **Notify on failures only** alerts only on failed runs. Turn it off to alert on every run.
- **Notify on recovery** sends one alert when a failing monitor passes again.

## History

The bar strip shows recent runs, green for passed and red for failed, along with an uptime percentage. Click any run to see its full results. **Run now** triggers a run immediately.

> **Note:** Monitors run from the Quiver server, so the server's network position decides which hosts they can reach.
