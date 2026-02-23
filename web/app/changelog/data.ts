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
        version: "0.2.0",
        date: "Feb 23rd, 2026",
        title: "Agent Engine & Background Workers",
        description:
            "The core agent engine is here. sustn now scans your repos, builds a prioritized backlog, and works through tasks autonomously using your remaining Claude Code budget.",
        image: {
            src: "/changelog/0.2.0-engine.png",
            alt: "Agent engine task queue interface",
        },
        features: [
            "Background agent engine that picks up tasks automatically",
            "Budget-aware scheduling — monitors your Claude Code subscription usage",
            "Automatic branch creation and git lifecycle management",
            "Implement + review loop with up to 2 retries per task",
            "Deep codebase scanning for dead code, missing tests, and tech debt",
        ],
        improvements: [
            "Task states now include `failed` for better visibility",
            "Tasks track source (manual/scan), estimated effort, and files involved",
        ],
        fixes: ["Fixed token counting for daily budget calculations"],
    },
    {
        version: "0.1.0",
        date: "Feb 10th, 2026",
        title: "Initial Release",
        description:
            "The first release of sustn. Point it at your repos, review the backlog, and let AI do the work.",
        features: [
            "Repository scanning and task discovery",
            "Drag-and-drop task prioritization",
            "One-click PR creation from completed branches",
            "macOS desktop app with native Tauri shell",
        ],
    },
];
