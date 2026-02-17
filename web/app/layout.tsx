import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "SUSTN - Background Conductor for AI Coding Agents",
    description:
        "Continuously improve your codebase using leftover AI subscription budget. All changes land as branches and PRs.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
