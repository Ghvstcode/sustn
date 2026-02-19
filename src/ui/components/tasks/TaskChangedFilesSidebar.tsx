import { useState } from "react";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import type { DiffFileStat } from "@core/api/useEngine";

interface TaskChangedFilesSidebarProps {
    files: DiffFileStat[];
    activeFile: string | undefined;
    onFileSelect: (file: string) => void;
    actions?: React.ReactNode;
}

function getFileName(path: string): string {
    return path.split("/").pop() ?? path;
}

function getDirPath(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/") + "/";
}

export function TaskChangedFilesSidebar({
    files,
    activeFile,
    onFileSelect,
    actions,
}: TaskChangedFilesSidebarProps) {
    const [tab, setTab] = useState<"changes" | "files">("changes");

    return (
        <div className="flex flex-col h-full border-l border-border">
            {/* Actions area — matches header height so borders align */}
            <div className="flex items-center justify-end gap-2 h-[60px] border-b border-border shrink-0 px-3 overflow-hidden">
                {actions}
            </div>

            {/* Tab bar — h-9 to match content tab bar */}
            <div className="flex items-center h-9 shrink-0 px-3 gap-1">
                <button
                    type="button"
                    onClick={() => setTab("changes")}
                    className={`relative flex items-center h-full px-2 text-sm transition-colors ${
                        tab === "changes"
                            ? "text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Changes
                    <span className="ml-1.5 text-xs opacity-50">
                        {files.length}
                    </span>
                    {tab === "changes" && (
                        <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-foreground rounded-full" />
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setTab("files")}
                    className={`relative flex items-center h-full px-2 text-sm transition-colors ${
                        tab === "files"
                            ? "text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Files
                    {tab === "files" && (
                        <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-foreground rounded-full" />
                    )}
                </button>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1">
                <div className="py-1">
                    {files.map((file) => {
                        const isActive = activeFile === file.file;
                        const dir = getDirPath(file.file);
                        const name = getFileName(file.file);

                        return (
                            <button
                                key={file.file}
                                type="button"
                                onClick={() => onFileSelect(file.file)}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                                    isActive
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                }`}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="truncate">
                                        {dir && (
                                            <span className="text-xs text-muted-foreground/50">
                                                {dir}
                                            </span>
                                        )}
                                        <span
                                            className={`text-sm ${isActive ? "font-medium" : ""}`}
                                        >
                                            {name}
                                        </span>
                                    </div>
                                </div>
                                {tab === "changes" && (
                                    <div className="flex items-center gap-1.5 shrink-0 text-xs font-mono">
                                        {file.additions > 0 && (
                                            <span className="text-green-500/70">
                                                +{file.additions}
                                            </span>
                                        )}
                                        {file.deletions > 0 && (
                                            <span className="text-red-500/70">
                                                -{file.deletions}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
}
