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
