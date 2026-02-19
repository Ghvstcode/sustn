import { useState, useMemo, useRef, useEffect } from "react";
import { parseDiff, Diff, Hunk, tokenize, markEdits } from "react-diff-view";
import type { ViewType, FileData, HunkData } from "react-diff-view";
import { Columns2, Rows3, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@ui/components/ui/button";
import "react-diff-view/style/index.css";

interface TaskDiffViewerProps {
    diffText: string;
    activeFile?: string;
}

// ── File diff section ──────────────────────────────────────

function FileDiff({
    file,
    viewType,
    isActive,
    id,
}: {
    file: FileData;
    viewType: ViewType;
    isActive: boolean;
    id: string;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Scroll into view when active
    useEffect(() => {
        if (isActive && ref.current) {
            ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [isActive]);

    const fileName = file.newPath === "/dev/null" ? file.oldPath : file.newPath;

    const tokens = useMemo(() => {
        if (collapsed || !file.hunks || file.hunks.length === 0)
            return undefined;
        try {
            return tokenize(file.hunks, {
                highlight: false as const,
                enhancers: [markEdits(file.hunks, { type: "block" })],
            });
        } catch {
            return undefined;
        }
    }, [file.hunks, collapsed]);

    return (
        <div
            ref={ref}
            id={id}
            className="border border-border rounded-lg overflow-hidden"
        >
            {/* File header */}
            <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
            >
                {collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-mono font-medium text-foreground flex-1 truncate">
                    {fileName}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                    {file.type === "add"
                        ? "new file"
                        : file.type === "delete"
                          ? "deleted"
                          : file.type === "rename"
                            ? `renamed from ${file.oldPath}`
                            : "modified"}
                </span>
            </button>

            {/* Diff content */}
            {!collapsed && file.hunks && file.hunks.length > 0 && (
                <div className="diff-viewer-content overflow-x-auto text-xs">
                    <Diff
                        viewType={viewType}
                        diffType={file.type}
                        hunks={file.hunks}
                        tokens={tokens ?? undefined}
                    >
                        {(hunks: HunkData[]) =>
                            hunks.map((hunk) => (
                                <Hunk key={hunk.content} hunk={hunk} />
                            ))
                        }
                    </Diff>
                </div>
            )}
        </div>
    );
}

// ── Main diff viewer ───────────────────────────────────────

export function TaskDiffViewer({ diffText, activeFile }: TaskDiffViewerProps) {
    const [viewType, setViewType] = useState<ViewType>("unified");

    const files = useMemo(() => {
        if (!diffText) return [];
        try {
            return parseDiff(diffText);
        } catch {
            return [];
        }
    }, [diffText]);

    if (files.length === 0) {
        return (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground/70">
                    No changes to display.
                </p>
            </div>
        );
    }

    return (
        <div>
            {/* Controls */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-foreground">Changes</h3>
                <div className="flex items-center gap-1">
                    <Button
                        variant={viewType === "unified" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setViewType("unified")}
                    >
                        <Rows3 className="h-3 w-3" />
                        Unified
                    </Button>
                    <Button
                        variant={viewType === "split" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setViewType("split")}
                    >
                        <Columns2 className="h-3 w-3" />
                        Split
                    </Button>
                </div>
            </div>

            {/* File diffs */}
            <div className="space-y-3">
                {files.map((file) => {
                    const fileName =
                        file.newPath === "/dev/null"
                            ? file.oldPath
                            : file.newPath;
                    return (
                        <FileDiff
                            key={fileName}
                            file={file}
                            viewType={viewType}
                            isActive={activeFile === fileName}
                            id={`diff-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}`}
                        />
                    );
                })}
            </div>
        </div>
    );
}
