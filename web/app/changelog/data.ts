export interface ChangelogImage {
    src: string;
    alt: string;
}

export interface ChangelogEntry {
    version: string;
    date: string; // e.g. "Feb 23rd, 2026"
    title: string;
    description?: string;
    image?: ChangelogImage;
    features?: string[];
    improvements?: string[];
    fixes?: string[];
}

export const changelog: ChangelogEntry[] = [
    {
        version: "0.3.0",
        date: "Mar 23rd, 2026",
        title: "Linear Integration",
        description:
            "Import issues from Linear as SUSTN tasks, with full lifecycle support from sync through execution to PR link-back.",
        image: {
            src: "/changelog/linear_integration.png",
            alt: "Linear integration settings and task view",
        },
        features: [
            "Linear issue import — sync issues from any Linear team and project as SUSTN tasks, with automatic category inference from labels and effort from priority",
            "Configurable auto-sync schedules: manual, on launch, every 6h, 12h, or daily",
            "New Integrations tab in Settings for Linear API key management, connection testing, and per-project sync configuration",
            "Linear identifier badges on tasks (e.g. SYN-460), clickable to open the issue in Linear",
            "Automatic PR link-back — when SUSTN creates a PR for a Linear issue, it posts a comment on the Linear issue with the PR link",
        ],
        improvements: [
            "Linear-style branch names for imported issues (e.g. sustn/syn-460-improve-accounts-table)",
            "Linear tasks sort to the top of the task list for higher visibility",
            "Tauri-side scan command now returns Linear metadata (identifier, URL) for imported tasks",
        ],
    },
    {
        version: "0.2.0",
        date: "Mar 18th, 2026",
        title: "New Diff Viewer & Inline Comments",
        description:
            "A completely overhauled diff viewer powered by @pierre/diffs, with inline commenting for precise code review feedback.",
        image: {
            src: "/changelog/inline_comments_diff.png",
            alt: "New diff viewer with inline comments",
        },
        features: [
            "New diff renderer built on @pierre/diffs with Shiki-powered syntax highlighting, split and unified views, and word-level inline change detection",
            "Inline comments — click the gutter to leave comments on specific diff lines, which are sent as structured feedback when requesting changes",
            "Line selection — click and drag to highlight line ranges in the diff during review",
        ],
        improvements: [
            "Smarter review loop: critical issues (bugs, security, data loss) are distinguished from non-critical suggestions — tasks soft-pass after max retries when only style nits remain",
            "Increased max review retries from 2 to 4 for more thorough agent self-correction",
            "Cleaner error messages — removed raw Rust Debug formatting from user-facing error strings",
        ],
        fixes: [
            "Pre-flight environment checks now detect common issues (Xcode license not accepted, git not found) before starting a task, with an in-app 'Fix in Terminal' button",
            "Environment issue listener now stays active across all routes including settings",
        ],
    },
    {
        version: "0.1.1",
        date: "Feb 24th, 2026",
        title: "Preflight Fix",
        description:
            "Fixes preflight environment checks when running as a macOS app.",
        fixes: [
            "Claude Code, Git, and GitHub CLI preflight checks now resolve binaries from well-known install paths instead of relying on shell `PATH`, fixing false negatives when launched outside a terminal",
        ],
    },
    {
        version: "0.1.0",
        date: "Feb 24th, 2026",
        title: "Initial Beta Release",
        description:
            "The first release of sustn. Point it at your repos, review the backlog, and let AI do the work.",
        image: {
            src: "/changelog/sustn_screenshot.png",
            alt: "sustn screenshot",
        },
        features: [
            "Repository scanning and task discovery",
            "Drag-and-drop task prioritization",
            "One-click PR creation from completed branches",
            "macOS desktop app with native Tauri shell",
        ],
    },
];
