# Privacy & Analytics

## Data Collection

SUSTN collects anonymous usage analytics to help improve the product. This feature is **disabled by default** (opt-out) and can be enabled or disabled at any time in Settings → General → "Share anonymous usage data".

### What We Collect

When analytics is enabled, SUSTN tracks the following events:

- **Task events**: Task creation, completion, dismissal
- **Scan events**: Repository scans initiated and completed
- **PR events**: Pull request creation
- **Settings changes**: When you modify settings

### What We DON'T Collect

- **No code or file contents**: We never collect your source code
- **No repository names or paths**: Repository identifiers are anonymous UUIDs
- **No commit messages or PR content**: Only the fact that an action occurred
- **No personal information**: Beyond your GitHub user ID for authentication

### Event Examples

Here's what a typical event looks like:

```json
{
    "eventType": "task_created",
    "eventData": {
        "priority": "medium"
    },
    "clientTimestamp": "2026-03-17T10:30:00Z"
}
```

### How to Disable Analytics

1. Open SUSTN
2. Navigate to Settings (⚙️ in the sidebar)
3. Click "General"
4. Toggle off "Share anonymous usage data"

Analytics is **disabled by default**. You must explicitly enable it to share usage data.

### Data Retention

Analytics events are stored on our server for product improvement and debugging purposes. We do not sell or share this data with third parties.

### Authentication

Analytics requests use your GitHub access token for authentication to prevent abuse. This token is only used to verify your identity and is not logged or stored beyond the request lifecycle.

### Questions?

If you have questions about our privacy practices, please open an issue on GitHub or contact us at [support contact].
