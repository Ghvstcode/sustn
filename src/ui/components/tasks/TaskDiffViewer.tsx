import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, AnnotationSide } from "@pierre/diffs/react";
import type { SelectedLineRange } from "@pierre/diffs";
import { Columns2, Rows3, MessageSquare, X, Send } from "lucide-react";
import { Button } from "@ui/components/ui/button";

// ── Types ───────────────────────────────────────────────────

export interface InlineComment {
    id: string;
    side: AnnotationSide;
    lineNumber: number;
    text: string;
    fileName?: string;
}

interface TaskDiffViewerProps {
    diffText: string;
    activeFile?: string;
    singleFile?: string;
    comments?: InlineComment[];
    onAddComment?: (comment: Omit<InlineComment, "id">) => void;
    onRemoveComment?: (id: string) => void;
}

// ── Annotation metadata type ────────────────────────────────

interface CommentAnnotation {
    commentId: string;
    text: string;
}

// ── Inline comment form ─────────────────────────────────────

function CommentForm({
    onSubmit,
    onCancel,
}: {
    onSubmit: (text: string) => void;
    onCancel: () => void;
}) {
    const [text, setText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    function handleSubmit() {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        }
    }

    return (
        <div className="flex flex-col gap-2 p-3 bg-background border border-border rounded-lg shadow-lg max-w-md w-full">
            <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Leave a comment on this line..."
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/40">
                    <kbd className="rounded border border-border/40 bg-muted/50 px-1 font-mono">
                        {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵
                    </kbd>{" "}
                    to submit
                </span>
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={onCancel}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-6 text-xs px-2 gap-1"
                        onClick={handleSubmit}
                        disabled={!text.trim()}
                    >
                        <Send className="h-3 w-3" />
                        Comment
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ── Rendered comment bubble ─────────────────────────────────

function CommentBubble({
    text,
    onRemove,
}: {
    text: string;
    onRemove: () => void;
}) {
    return (
        <div className="group/comment flex items-start gap-2 px-3 py-2 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 rounded-lg max-w-md w-full">
            <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="flex-1 text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {text}
            </p>
            <button
                type="button"
                onClick={onRemove}
                className="shrink-0 rounded p-0.5 opacity-0 group-hover/comment:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
}

// ── Main diff viewer ───────────────────────────────────────

export function TaskDiffViewer({
    diffText,
    singleFile,
    comments = [],
    onAddComment,
    onRemoveComment,
}: TaskDiffViewerProps) {
    const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
    const [selectedLines, setSelectedLines] =
        useState<SelectedLineRange | null>(null);
    const [commentTarget, setCommentTarget] = useState<{
        side: AnnotationSide;
        lineNumber: number;
    } | null>(null);

    // Filter the patch to a single file if requested
    const patchToRender = useMemo(() => {
        if (!diffText) return "";
        if (!singleFile) return diffText;

        try {
            const lines = diffText.split("\n");
            const fileStartIndices: number[] = [];

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith("diff --git")) {
                    fileStartIndices.push(i);
                }
            }

            for (let idx = 0; idx < fileStartIndices.length; idx++) {
                const start = fileStartIndices[idx];
                const end = fileStartIndices[idx + 1] ?? lines.length;
                const section = lines.slice(start, end).join("\n");

                const diffLine = lines[start];
                if (
                    diffLine.includes(`b/${singleFile}`) ||
                    diffLine.includes(`a/${singleFile}`)
                ) {
                    return section;
                }
            }
        } catch {
            // Fall through to full diff
        }

        return diffText;
    }, [diffText, singleFile]);

    // Count files for the header
    const fileCount = useMemo(() => {
        if (!diffText) return 0;
        return (diffText.match(/^diff --git/gm) ?? []).length;
    }, [diffText]);

    // Build annotation list from comments
    const lineAnnotations = useMemo<
        DiffLineAnnotation<CommentAnnotation>[]
    >(() => {
        return comments
            .filter((c) => {
                if (!singleFile) return true;
                return !c.fileName || c.fileName === singleFile;
            })
            .map((c) => ({
                side: c.side,
                lineNumber: c.lineNumber,
                metadata: { commentId: c.id, text: c.text },
            }));
    }, [comments, singleFile]);

    // Include the "new comment" form as an annotation too
    const allAnnotations = useMemo<
        DiffLineAnnotation<CommentAnnotation>[]
    >(() => {
        if (!commentTarget) return lineAnnotations;
        return [
            ...lineAnnotations,
            {
                side: commentTarget.side,
                lineNumber: commentTarget.lineNumber,
                metadata: { commentId: "__new__", text: "" },
            },
        ];
    }, [lineAnnotations, commentTarget]);

    const handleLineSelected = useCallback(
        (range: SelectedLineRange | null) => {
            setSelectedLines(range);
        },
        [],
    );

    const handleGutterClick = useCallback(
        (range: SelectedLineRange) => {
            if (!onAddComment) return;
            setCommentTarget({
                side: range.side ?? "additions",
                lineNumber: range.start,
            });
        },
        [onAddComment],
    );

    const handleCommentSubmit = useCallback(
        (text: string) => {
            if (!commentTarget || !onAddComment) return;
            onAddComment({
                side: commentTarget.side,
                lineNumber: commentTarget.lineNumber,
                text,
                fileName: singleFile,
            });
            setCommentTarget(null);
        },
        [commentTarget, onAddComment, singleFile],
    );

    const handleCommentCancel = useCallback(() => {
        setCommentTarget(null);
    }, []);

    const renderAnnotation = useCallback(
        (annotation: DiffLineAnnotation<CommentAnnotation>) => {
            if (!annotation.metadata) return null;

            if (annotation.metadata.commentId === "__new__") {
                return (
                    <CommentForm
                        onSubmit={handleCommentSubmit}
                        onCancel={handleCommentCancel}
                    />
                );
            }

            return (
                <CommentBubble
                    text={annotation.metadata.text}
                    onRemove={() =>
                        onRemoveComment?.(annotation.metadata.commentId)
                    }
                />
            );
        },
        [handleCommentSubmit, handleCommentCancel, onRemoveComment],
    );

    const isInteractive = !!onAddComment;

    const options = useMemo(
        () => ({
            diffStyle,
            diffIndicators: "bars" as const,
            lineDiffType: "word-alt" as const,
            expandUnchanged: true,
            theme: {
                dark: "github-dark" as const,
                light: "github-light" as const,
            },
            themeType: "system" as const,
            overflow: "scroll" as const,
            enableLineSelection: isInteractive,
            onLineSelected: isInteractive ? handleLineSelected : undefined,
            enableGutterUtility: isInteractive,
            onGutterUtilityClick: isInteractive ? handleGutterClick : undefined,
        }),
        [diffStyle, isInteractive, handleLineSelected, handleGutterClick],
    );

    if (!patchToRender) {
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
                {singleFile ? (
                    <span className="text-xs font-mono text-muted-foreground/50 truncate">
                        {singleFile}
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground/50">
                        {fileCount} {fileCount === 1 ? "file" : "files"} changed
                    </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                    {comments.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mr-2">
                            <MessageSquare className="h-3 w-3" />
                            {comments.length}
                        </span>
                    )}
                    <Button
                        variant={
                            diffStyle === "unified" ? "secondary" : "ghost"
                        }
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setDiffStyle("unified")}
                    >
                        <Rows3 className="h-3 w-3" />
                        Unified
                    </Button>
                    <Button
                        variant={diffStyle === "split" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setDiffStyle("split")}
                    >
                        <Columns2 className="h-3 w-3" />
                        Split
                    </Button>
                </div>
            </div>

            {/* Diff content */}
            <div className="rounded-lg border border-border overflow-hidden">
                <PatchDiff<CommentAnnotation>
                    patch={patchToRender}
                    options={options}
                    selectedLines={selectedLines}
                    lineAnnotations={allAnnotations}
                    renderAnnotation={renderAnnotation}
                />
            </div>
        </div>
    );
}
