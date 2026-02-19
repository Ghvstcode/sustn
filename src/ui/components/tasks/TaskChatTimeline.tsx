import { useState, useRef, useEffect, useMemo } from "react";
import {
    ArrowRight,
    MessageSquare,
    Pencil,
    Plus,
    FileText,
    Tag,
    Link,
    Send,
    Bot,
    User,
} from "lucide-react";
import { Button } from "@ui/components/ui/button";
import { Textarea } from "@ui/components/ui/textarea";
import {
    useTaskEvents,
    useTaskMessages,
    useSendMessage,
} from "@core/api/useTasks";
import type { TaskEvent } from "@core/types/task";
import type { TaskMessage } from "@core/types/task";

interface TaskChatTimelineProps {
    taskId: string;
    readOnly?: boolean;
}

// ── Timeline item types ────────────────────────────────────

type TimelineItem =
    | { kind: "event"; data: TaskEvent }
    | { kind: "message"; data: TaskMessage };

// ── Helpers ────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

const stateLabels: Record<string, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    review: "Awaiting Review",
    done: "Done",
    dismissed: "Dismissed",
    failed: "Failed",
};

// ── Event rendering ────────────────────────────────────────

function EventIcon({ eventType }: { eventType: string }) {
    const cls = "h-3 w-3";
    switch (eventType) {
        case "created":
            return <Plus className={cls} />;
        case "state_change":
            return <ArrowRight className={cls} />;
        case "title_change":
            return <Pencil className={cls} />;
        case "comment":
            return <MessageSquare className={cls} />;
        case "notes_change":
            return <FileText className={cls} />;
        case "category_change":
            return <Tag className={cls} />;
        case "pr_url_change":
            return <Link className={cls} />;
        default:
            return <Pencil className={cls} />;
    }
}

function EventDescription({ event }: { event: TaskEvent }) {
    switch (event.eventType) {
        case "created":
            return (
                <span>
                    Task created
                    {event.comment && (
                        <span className="text-muted-foreground/70">
                            {" "}
                            — {event.comment}
                        </span>
                    )}
                </span>
            );
        case "state_change":
            return (
                <span>
                    Moved to{" "}
                    <span className="font-medium">
                        {stateLabels[event.newValue ?? ""] ?? event.newValue}
                    </span>
                    {event.comment && (
                        <span className="text-muted-foreground/70">
                            {" "}
                            — {event.comment}
                        </span>
                    )}
                </span>
            );
        case "title_change":
            return (
                <span>
                    Title changed to{" "}
                    <span className="font-medium">{event.newValue}</span>
                </span>
            );
        case "comment":
            return <span>{event.comment}</span>;
        case "description_change":
            return <span>Description updated</span>;
        case "notes_change":
            return <span>Notes updated</span>;
        case "category_change":
            return (
                <span>
                    Category changed to{" "}
                    <span className="font-medium">{event.newValue}</span>
                </span>
            );
        case "pr_url_change":
            return <span>PR link updated</span>;
        default:
            return <span>{event.eventType}</span>;
    }
}

// ── System event row ───────────────────────────────────────

function SystemEvent({ event }: { event: TaskEvent }) {
    return (
        <div className="flex items-center gap-2 py-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                <EventIcon eventType={event.eventType} />
            </div>
            <span className="text-xs text-muted-foreground leading-relaxed flex-1">
                <EventDescription event={event} />
            </span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {formatRelativeTime(event.createdAt)}
            </span>
        </div>
    );
}

// ── Chat message bubble ────────────────────────────────────

function ChatBubble({ message }: { message: TaskMessage }) {
    const isUser = message.role === "user";
    const isAgent = message.role === "agent";

    return (
        <div
            className={`flex gap-2 py-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
        >
            <div
                className={`flex h-6 w-6 items-center justify-center rounded-full shrink-0 ${
                    isAgent
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                }`}
            >
                {isAgent ? (
                    <Bot className="h-3.5 w-3.5" />
                ) : (
                    <User className="h-3.5 w-3.5" />
                )}
            </div>
            <div
                className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    isUser
                        ? "bg-primary text-primary-foreground"
                        : isAgent
                          ? "bg-muted"
                          : "bg-muted/50"
                }`}
            >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p
                    className={`text-[10px] mt-1 ${
                        isUser
                            ? "text-primary-foreground/50"
                            : "text-muted-foreground/50"
                    }`}
                >
                    {formatRelativeTime(message.createdAt)}
                </p>
            </div>
        </div>
    );
}

// ── Chat input ─────────────────────────────────────────────

function ChatInput({
    taskId,
    placeholder,
}: {
    taskId: string;
    placeholder?: string;
}) {
    const [draft, setDraft] = useState("");
    const sendMessage = useSendMessage();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    function handleSend() {
        const trimmed = draft.trim();
        if (!trimmed) return;

        sendMessage.mutate(
            { taskId, role: "user", content: trimmed },
            { onSuccess: () => setDraft("") },
        );
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    return (
        <div className="flex gap-2 pt-3 border-t border-border">
            <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder ?? "Add context for the agent..."}
                rows={1}
                className="resize-none text-sm min-h-[36px] max-h-[120px]"
            />
            <Button
                size="sm"
                className="shrink-0 h-9 w-9 p-0"
                onClick={handleSend}
                disabled={!draft.trim() || sendMessage.isPending}
            >
                <Send className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────

export function TaskChatTimeline({ taskId, readOnly }: TaskChatTimelineProps) {
    const { data: events } = useTaskEvents(taskId);
    const { data: messages } = useTaskMessages(taskId);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Merge events and messages into a unified timeline
    const timeline = useMemo<TimelineItem[]>(() => {
        const items: TimelineItem[] = [];

        if (events) {
            for (const event of events) {
                // Skip "comment" events — those are now handled via task_messages
                if (event.eventType === "comment") continue;
                items.push({ kind: "event", data: event });
            }
        }

        if (messages) {
            for (const message of messages) {
                items.push({ kind: "message", data: message });
            }
        }

        // Sort chronologically (oldest first)
        items.sort(
            (a, b) =>
                new Date(
                    a.kind === "event" ? a.data.createdAt : a.data.createdAt,
                ).getTime() -
                new Date(
                    b.kind === "event" ? b.data.createdAt : b.data.createdAt,
                ).getTime(),
        );

        return items;
    }, [events, messages]);

    // Auto-scroll to bottom when new items appear
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [timeline.length]);

    return (
        <div className="flex flex-col">
            <h3 className="text-sm font-medium text-foreground mb-2">
                Activity & Chat
            </h3>

            {/* Timeline */}
            <div
                ref={scrollRef}
                className="max-h-[400px] overflow-y-auto space-y-0.5 pr-1"
            >
                {timeline.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 py-2">
                        No activity yet.
                    </p>
                )}
                {timeline.map((item) => {
                    if (item.kind === "event") {
                        return (
                            <SystemEvent
                                key={`e-${item.data.id}`}
                                event={item.data}
                            />
                        );
                    }
                    return (
                        <ChatBubble
                            key={`m-${item.data.id}`}
                            message={item.data}
                        />
                    );
                })}
            </div>

            {/* Input */}
            {!readOnly && <ChatInput taskId={taskId} />}
        </div>
    );
}
