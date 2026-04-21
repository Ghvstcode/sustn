/**
 * Translates raw backend/CLI error strings into user-friendly messages
 * with recovery guidance. Unknown errors get a generic wrapper that
 * preserves the raw detail for debugging.
 */

interface ErrorMapping {
    pattern: RegExp;
    message: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
    {
        pattern: /budget exhausted/i,
        message:
            "Your weekly token budget has been used up. Tasks will resume when your budget refreshes, or you can increase your budget ceiling in Settings.",
    },
    {
        pattern: /repository not found/i,
        message:
            "This repository URL doesn't exist or you don't have access. Check the URL and your GitHub permissions.",
    },
    {
        pattern: /already exists and is not an empty directory/i,
        message:
            "A folder with this name already exists at the chosen location. Pick a different destination or remove the existing folder first.",
    },
    {
        pattern: /could not resolve host/i,
        message:
            "Couldn't reach the remote server. Check your internet connection and try again.",
    },
    {
        pattern: /authentication failed/i,
        message:
            "Git authentication failed. Check that your credentials or SSH key are set up correctly.",
    },
    {
        pattern: /permission denied/i,
        message:
            "Permission denied. Make sure you have the right access to this repository.",
    },
    {
        pattern: /exit -1|exit code: -1|timed?\s*out/i,
        message:
            "The AI agent timed out. The task may be too complex — try breaking it into smaller pieces.",
    },
    {
        pattern: /Claude CLI failed \(exit \d+\)/i,
        message:
            "The AI agent encountered an error and stopped. You can retry the task, or check the logs for details.",
    },
    {
        pattern: /not a git repository/i,
        message:
            "This folder isn't a Git repository. Make sure you're pointing to the right directory.",
    },
    {
        pattern: /failed to push/i,
        message:
            "Couldn't push the branch to the remote. Check your network connection and repository permissions.",
    },
];

/**
 * Convert a raw error string to a user-friendly message.
 * The raw error is always logged to console for debugging.
 */
export function toFriendlyError(raw: string): string {
    console.error("[raw error]", raw);

    for (const { pattern, message } of ERROR_MAPPINGS) {
        if (pattern.test(raw)) {
            return message;
        }
    }

    return `Something went wrong. Error details: ${raw}`;
}
