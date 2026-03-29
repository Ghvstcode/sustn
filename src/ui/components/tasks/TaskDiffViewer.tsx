import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, AnnotationSide } from "@pierre/diffs/react";
import type { SelectedLineRange } from "@pierre/diffs";
import {
    Columns2,
    Rows3,
    MessageSquare,
    X,
    Send,
    Reply,
    CheckCircle,
} from "lucide-react";
import { Button } from "@ui/components/ui/button";

// ── Types ───────────────────────────────────────────────────

export interface InlineComment {
    id: string;
    side: AnnotationSide;
    lineNumber: number;
    text: string;
    fileName?: string;
}

export interface GitHubPrComment {
    id: string;
    githubCommentId: number;
    reviewer: string;
    body: string;
    path?: string;
    line?: number;
    side?: "LEFT" | "RIGHT";
    classification?: "actionable" | "conversational" | "resolved";
    ourReply?: string;
    addressedInCommit?: string;
    createdAt: string;
}

interface TaskDiffViewerProps {
    diffText: string;
    activeFile?: string;
    singleFile?: string;
    comments?: InlineComment[];
    ghComments?: GitHubPrComment[];
    onAddComment?: (comment: Omit<InlineComment, "id">) => void;
    onRemoveComment?: (id: string) => void;
    onReplyToGhComment?: (commentId: number, body: string) => void;
}

// ── Annotation metadata type ────────────────────────────────

interface CommentAnnotation {
    commentId: string;
    text: string;
    isGitHub?: boolean;
    reviewer?: string;
    classification?: string;
    ourReply?: string;
    githubCommentId?: number;
    addressedInCommit?: string;
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

// ── GitHub PR comment thread ────────────────────────────────

function ReviewerAvatar({ name }: { name: string }) {
    const initial = name.charAt(0).toUpperCase();
    return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-[11px] font-bold text-white shadow-sm">
            {initial}
        </div>
    );
}

function GitHubCommentBubble({
    reviewer,
    text,
    ourReply,
    addressedInCommit,
    classification,
    onReply,
}: {
    reviewer: string;
    text: string;
    ourReply?: string;
    addressedInCommit?: string;
    classification?: string;
    onReply?: (body: string) => void;
}) {
    const [showReply, setShowReply] = useState(false);
    const [replyText, setReplyText] = useState("");
    const replyRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (showReply) replyRef.current?.focus();
    }, [showReply]);

    const isResolved = !!addressedInCommit || classification === "resolved";

    return (
        <div className="my-1 w-full max-w-xl">
            {/* Review comment */}
            <div className="flex gap-2.5">
                <div className="flex flex-col items-center">
                    <ReviewerAvatar name={reviewer} />
                    {ourReply && <div className="mt-1 w-px flex-1 bg-border" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div
                        className={`rounded-lg border overflow-hidden ${
                            isResolved
                                ? "border-green-300/50 dark:border-green-700/50"
                                : "border-border"
                        }`}
                    >
                        {/* Comment header */}
                        <div
                            className={`flex items-center gap-2 px-3 py-1.5 ${
                                isResolved
                                    ? "bg-green-50/80 dark:bg-green-950/40"
                                    : "bg-muted/60"
                            }`}
                        >
                            <span className="text-xs font-semibold text-foreground">
                                {reviewer}
                            </span>
                            {isResolved && (
                                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
                                    <CheckCircle className="h-3 w-3" />
                                    Resolved
                                </span>
                            )}
                        </div>

                        {/* Comment body */}
                        <div className="px-3 py-3 bg-background">
                            <p className="text-[13px] leading-[1.6] text-foreground whitespace-pre-wrap break-words">
                                {text}
                            </p>
                        </div>

                        {/* Reply action bar */}
                        {onReply && !ourReply && !showReply && (
                            <div className="flex items-center border-t border-border bg-muted/30 px-3 py-1.5">
                                <button
                                    type="button"
                                    onClick={() => setShowReply(true)}
                                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <Reply className="h-3.5 w-3.5" />
                                    Reply
                                </button>
                            </div>
                        )}

                        {/* Reply form */}
                        {showReply && (
                            <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-2.5">
                                <textarea
                                    ref={replyRef}
                                    value={replyText}
                                    onChange={(e) =>
                                        setReplyText(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" &&
                                            (e.metaKey || e.ctrlKey)
                                        ) {
                                            e.preventDefault();
                                            if (replyText.trim() && onReply) {
                                                onReply(replyText.trim());
                                                setShowReply(false);
                                                setReplyText("");
                                            }
                                        }
                                        if (e.key === "Escape") {
                                            setShowReply(false);
                                            setReplyText("");
                                        }
                                    }}
                                    placeholder="Write a reply..."
                                    rows={3}
                                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                                />
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground/50">
                                        <kbd className="rounded border border-border/50 bg-muted/60 px-1 py-0.5 font-mono text-[9px]">
                                            {navigator.platform.includes("Mac")
                                                ? "⌘"
                                                : "Ctrl"}
                                            +↵
                                        </kbd>{" "}
                                        to submit
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs px-2.5"
                                            onClick={() => {
                                                setShowReply(false);
                                                setReplyText("");
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs px-3 gap-1.5"
                                            onClick={() => {
                                                if (
                                                    replyText.trim() &&
                                                    onReply
                                                ) {
                                                    onReply(replyText.trim());
                                                    setShowReply(false);
                                                    setReplyText("");
                                                }
                                            }}
                                            disabled={!replyText.trim()}
                                        >
                                            <Send className="h-3 w-3" />
                                            Reply
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Threaded reply (connected via timeline line) */}
            {ourReply && (
                <div className="flex gap-2.5 mt-0">
                    <div className="flex w-7 justify-center">
                        <div className="w-px bg-border" />
                    </div>
                    <div className="flex-1 min-w-0 pt-2 pb-1">
                        <div className="rounded-lg border border-border overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[9px] font-bold text-white">
                                    S
                                </div>
                                <span className="text-xs font-semibold text-foreground">
                                    You
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                    via SUSTN
                                </span>
                            </div>
                            <div className="px-3 py-3 bg-background">
                                <p className="text-[13px] leading-[1.6] text-foreground whitespace-pre-wrap break-words">
                                    {ourReply}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main diff viewer ───────────────────────────────────────

export function TaskDiffViewer({
    diffText,
    singleFile,
    comments = [],
    ghComments = [],
    onAddComment,
    onRemoveComment,
    onReplyToGhComment,
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

    // Build annotation list from local comments + GitHub PR comments
    const lineAnnotations = useMemo<
        DiffLineAnnotation<CommentAnnotation>[]
    >(() => {
        const local = comments
            .filter((c) => {
                if (!singleFile) return true;
                return !c.fileName || c.fileName === singleFile;
            })
            .map((c) => ({
                side: c.side,
                lineNumber: c.lineNumber,
                metadata: { commentId: c.id, text: c.text },
            }));

        const github = ghComments
            .filter((c) => {
                if (!c.path || !c.line) return false;
                if (!singleFile) return true;
                return c.path === singleFile;
            })
            .map((c) => ({
                side: (c.side === "LEFT"
                    ? "deletions"
                    : "additions") as AnnotationSide,
                lineNumber: c.line!,
                metadata: {
                    commentId: `gh-${c.githubCommentId}`,
                    text: c.body,
                    isGitHub: true,
                    reviewer: c.reviewer,
                    classification: c.classification,
                    ourReply: c.ourReply,
                    githubCommentId: c.githubCommentId,
                    addressedInCommit: c.addressedInCommit,
                },
            }));

        return [...local, ...github];
    }, [comments, ghComments, singleFile]);

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

            // GitHub PR comment
            if (annotation.metadata.isGitHub) {
                return (
                    <GitHubCommentBubble
                        reviewer={annotation.metadata.reviewer ?? "unknown"}
                        text={annotation.metadata.text}
                        classification={annotation.metadata.classification}
                        ourReply={annotation.metadata.ourReply}
                        addressedInCommit={
                            annotation.metadata.addressedInCommit
                        }
                        onReply={
                            onReplyToGhComment &&
                            annotation.metadata.githubCommentId
                                ? (body) =>
                                      onReplyToGhComment(
                                          annotation.metadata.githubCommentId!,
                                          body,
                                      )
                                : undefined
                        }
                    />
                );
            }

            // Local SUSTN comment
            return (
                <CommentBubble
                    text={annotation.metadata.text}
                    onRemove={() =>
                        onRemoveComment?.(annotation.metadata.commentId)
                    }
                />
            );
        },
        [
            handleCommentSubmit,
            handleCommentCancel,
            onRemoveComment,
            onReplyToGhComment,
        ],
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
                    {(comments.length > 0 || ghComments.length > 0) && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
                            <MessageSquare className="h-3 w-3" />
                            {comments.length + ghComments.length}
                            {ghComments.length > 0 && (
                                <span className="text-blue-500 text-[10px]">
                                    ({ghComments.length} from PR)
                                </span>
                            )}
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
