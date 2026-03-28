/**
 * PR Lifecycle Management Service
 *
 * Orchestrates the full lifecycle of PRs opened by SUSTN:
 *   opened → in_review → changes_requested → addressing → re_review_requested → approved → merged
 *
 * Polls GitHub for review events, classifies comments via Claude,
 * addresses actionable feedback, replies to conversational comments,
 * and re-requests review when done.
 */

import { invoke } from "@tauri-apps/api/core";
import { updateTask, getTask } from "@core/db/tasks";
import {
    getTasksWithActivePr,
    upsertReview,
    upsertComment,
    listComments,
    updateCommentClassification,
    markCommentAddressed,
    setCommentReply,
} from "@core/db/pr-lifecycle";
import {
    parseOwnerRepo,
    listPrReviews,
    listPrComments,
    getPrStatus,
    replyToComment,
    postPrComment,
    requestReview,
} from "@core/services/github";
import { listRepositories } from "@core/db/repositories";
import { getGlobalSettings } from "@core/db/settings";
import type { WorkResult } from "@core/types/agent";
import type { PrState, Task } from "@core/types/task";
import type { GhPrComment, GhPrReview } from "@core/services/github";

// ── Classification ──────────────────────────────────────────

interface ClassificationResult {
    commentId: number;
    classification: "actionable" | "conversational";
    reply?: string; // For conversational comments
}

/**
 * Heuristic-based classification fallback.
 * Works without a Claude call for simple cases.
 */
function classifyCommentsHeuristic(
    comments: GhPrComment[],
): ClassificationResult[] {
    return comments.map((c) => {
        const body = c.body.toLowerCase();
        const isActionable =
            // Explicit change requests
            /\b(please|should|could you|can you|need to|must|change|rename|refactor|fix|update|move|remove|delete|add|replace|use instead|consider using)\b/i.test(
                c.body,
            ) &&
            // Not just a question
            !(
                /^(why|how|what|is this|does this|did you)\b/i.test(
                    c.body.trim(),
                ) && c.body.trim().endsWith("?")
            ) &&
            // Not praise
            !/^(nice|great|good|looks good|lgtm|nit:|nit\b|optional:)/i.test(
                c.body.trim(),
            );

        const isNit =
            /^nit[:\s]/i.test(c.body.trim()) || body.includes("optional");
        const isPraise =
            /\b(nice|great|good job|well done|looks good|lgtm|👍|🎉)\b/i.test(
                body,
            );

        if (isPraise || isNit) {
            return {
                commentId: c.id,
                classification: "conversational" as const,
                reply: isPraise ? "Thanks!" : undefined,
            };
        }

        return {
            commentId: c.id,
            classification: isActionable
                ? ("actionable" as const)
                : ("conversational" as const),
        };
    });
}

// ── Core Lifecycle ──────────────────────────────────────────

/**
 * Process a single task's PR lifecycle.
 * Called by the polling loop for each task with an active PR.
 */
export async function processTaskPr(
    task: Task,
    repoPath: string,
    maxReviewCycles: number,
): Promise<void> {
    if (!task.prUrl || !task.prNumber) return;

    const parsed = parseOwnerRepo(task.prUrl);
    if (!parsed) return;
    const { owner, repo, number: prNumber } = parsed;

    console.log(
        `[pr-lifecycle] processing ${task.prUrl} — current state: ${task.prState}`,
    );

    // 1. Check PR status (merged? closed?)
    let prStatus;
    try {
        prStatus = await getPrStatus(repoPath, owner, repo, prNumber);
    } catch (e) {
        console.error(`[pr-lifecycle] failed to get PR status:`, e);
        return;
    }

    if (prStatus.merged) {
        console.log(`[pr-lifecycle] PR #${prNumber} merged!`);
        await updateTask(task.id, { prState: "merged" as PrState });
        await recordPrEvent(task.id, "pr_merged", `PR #${prNumber} merged`);
        return;
    }

    if (prStatus.state === "closed") {
        console.log(`[pr-lifecycle] PR #${prNumber} closed without merge`);
        await updateTask(task.id, { prState: "merged" as PrState }); // terminal
        return;
    }

    // 2. Fetch reviews
    let reviews: GhPrReview[];
    try {
        reviews = await listPrReviews(repoPath, owner, repo, prNumber);
    } catch (e) {
        console.error(`[pr-lifecycle] failed to fetch reviews:`, e);
        return;
    }

    // 3. Sync reviews to DB
    for (const review of reviews) {
        await upsertReview(task.id, {
            githubReviewId: review.id,
            reviewer: review.user.login,
            state: review.state,
            body: review.body || undefined,
            submittedAt: review.submitted_at,
        });
    }

    // 4. Determine latest review state
    const latestReview = reviews
        .filter((r) => r.state !== "COMMENTED")
        .sort(
            (a, b) =>
                new Date(b.submitted_at).getTime() -
                new Date(a.submitted_at).getTime(),
        )[0];

    if (!latestReview) {
        // No actionable reviews yet — stay in current state
        if (task.prState === "opened") {
            await updateTask(task.id, { prState: "in_review" as PrState });
        }
        return;
    }

    // 5. Handle based on latest review
    if (latestReview.state === "APPROVED") {
        console.log(
            `[pr-lifecycle] PR #${prNumber} approved by @${latestReview.user.login}`,
        );
        await updateTask(task.id, { prState: "approved" as PrState });
        await recordPrEvent(
            task.id,
            "pr_approved",
            `@${latestReview.user.login} approved the PR`,
        );
        return;
    }

    if (latestReview.state === "CHANGES_REQUESTED") {
        // Check if we're already addressing or if this is old
        if (
            task.prState === "addressing" ||
            task.prState === "re_review_requested"
        ) {
            // Already addressing or waiting — check if this is a NEW review
            const existingInDb = await listComments(task.id);
            const latestDbReviewTime =
                existingInDb.length > 0
                    ? Math.max(
                          ...existingInDb.map((c) =>
                              new Date(c.createdAt).getTime(),
                          ),
                      )
                    : 0;
            const reviewTime = new Date(latestReview.submitted_at).getTime();
            if (reviewTime <= latestDbReviewTime) return; // Already processed
        }

        // Check cycle limit
        if (task.prReviewCycles >= maxReviewCycles) {
            console.log(
                `[pr-lifecycle] PR #${prNumber} — max review cycles (${maxReviewCycles}) reached, flagging for human attention`,
            );
            await updateTask(task.id, {
                prState: "needs_human_attention" as PrState,
                lastError: `Reviewer requested changes ${task.prReviewCycles} times — needs human review`,
            });
            await recordPrEvent(
                task.id,
                "pr_needs_human",
                `Max review cycles (${maxReviewCycles}) reached — flagged for human attention`,
            );
            return;
        }

        console.log(
            `[pr-lifecycle] PR #${prNumber} — changes requested by @${latestReview.user.login} (cycle ${task.prReviewCycles + 1}/${maxReviewCycles})`,
        );

        await updateTask(task.id, {
            prState: "changes_requested" as PrState,
            prReviewCycles: task.prReviewCycles + 1,
        });
        await recordPrEvent(
            task.id,
            "pr_review_received",
            `@${latestReview.user.login} requested changes (cycle ${task.prReviewCycles + 1})`,
        );

        // 6. Fetch and sync review comments
        let comments: GhPrComment[];
        try {
            comments = await listPrComments(repoPath, owner, repo, prNumber);
        } catch (e) {
            console.error(`[pr-lifecycle] failed to fetch comments:`, e);
            return;
        }

        for (const comment of comments) {
            await upsertComment(task.id, {
                githubCommentId: comment.id,
                inReplyToId: comment.in_reply_to_id ?? undefined,
                reviewer: comment.user.login,
                body: comment.body,
                path: comment.path ?? undefined,
                line: comment.line ?? comment.original_line ?? undefined,
                side: comment.side ?? undefined,
                commitId: comment.commit_id ?? undefined,
            });
        }

        // 7. Classify comments
        const newComments = comments.filter(
            (c) => c.in_reply_to_id == null, // Only top-level comments, not replies
        );
        const classifications = classifyCommentsHeuristic(newComments);

        for (const cls of classifications) {
            await updateCommentClassification(
                cls.commentId,
                cls.classification,
            );
        }

        // 8. Handle conversational comments — reply
        const conversational = classifications.filter(
            (c) => c.classification === "conversational" && c.reply,
        );
        for (const conv of conversational) {
            if (!conv.reply) continue;
            try {
                await replyToComment(
                    repoPath,
                    owner,
                    repo,
                    prNumber,
                    conv.commentId,
                    conv.reply,
                );
                await setCommentReply(conv.commentId, conv.reply);
                console.log(
                    `[pr-lifecycle] replied to comment ${conv.commentId}`,
                );
            } catch (e) {
                console.error(
                    `[pr-lifecycle] failed to reply to comment ${conv.commentId}:`,
                    e,
                );
            }
        }

        // 9. Handle actionable comments — address via agent
        const actionable = classifications.filter(
            (c) => c.classification === "actionable",
        );

        if (actionable.length > 0) {
            await updateTask(task.id, { prState: "addressing" as PrState });

            const actionableComments = comments.filter((c) =>
                actionable.some((a) => a.commentId === c.id),
            );

            const reviewContext = actionableComments
                .map((c) => {
                    const location = c.path
                        ? `File: ${c.path}${c.line ? `:${c.line}` : ""}`
                        : "General";
                    return `[${location}] @${c.user.login}: ${c.body}`;
                })
                .join("\n\n");

            try {
                const result = await invoke<WorkResult>(
                    "engine_address_review",
                    {
                        taskId: task.id,
                        repositoryId: task.repositoryId,
                        repoPath,
                        branchName: task.branchName,
                        baseBranch: task.baseBranch ?? "main",
                        reviewComments: reviewContext,
                        prDescription: task.description ?? task.title,
                    },
                );

                if (result.success) {
                    // Push the changes
                    const pushResult = await invoke<{
                        success: boolean;
                        error?: string;
                    }>("engine_push_branch", {
                        repoPath,
                        branchName: task.branchName,
                    });

                    if (pushResult.success) {
                        // Mark comments as addressed
                        for (const a of actionable) {
                            await markCommentAddressed(
                                a.commentId,
                                result.commitSha ?? "",
                            );
                        }

                        // Post a summary comment on the PR
                        const summary =
                            result.summary ?? "Addressed review comments";
                        await postPrComment(
                            repoPath,
                            owner,
                            repo,
                            prNumber,
                            `I've addressed the review feedback:\n\n${summary}\n\nCommit: ${result.commitSha ?? "latest"}`,
                        );

                        // Re-request review from the reviewer
                        try {
                            await requestReview(
                                repoPath,
                                owner,
                                repo,
                                prNumber,
                                [latestReview.user.login],
                            );
                        } catch (e) {
                            console.warn(
                                `[pr-lifecycle] re-request review failed (may not have permission):`,
                                e,
                            );
                        }

                        await updateTask(task.id, {
                            prState: "re_review_requested" as PrState,
                            commitSha: result.commitSha,
                        });
                        await recordPrEvent(
                            task.id,
                            "pr_comment_addressed",
                            `Agent pushed commit ${result.commitSha?.slice(0, 7) ?? "?"} addressing ${actionable.length} comment(s)`,
                        );
                    } else {
                        console.error(
                            `[pr-lifecycle] push failed:`,
                            pushResult.error,
                        );
                        await updateTask(task.id, {
                            prState: "changes_requested" as PrState,
                            lastError: `Failed to push changes: ${pushResult.error}`,
                        });
                    }
                } else {
                    console.error(
                        `[pr-lifecycle] address review failed:`,
                        result.error,
                    );
                    await updateTask(task.id, {
                        prState: "changes_requested" as PrState,
                        lastError: result.error ?? "Failed to address review",
                    });
                }
            } catch (e) {
                console.error(`[pr-lifecycle] address review error:`, e);
                await updateTask(task.id, {
                    prState: "changes_requested" as PrState,
                    lastError: e instanceof Error ? e.message : String(e),
                });
            }
        } else {
            // No actionable comments — just conversational, move back to waiting
            await updateTask(task.id, {
                prState: "re_review_requested" as PrState,
            });
        }
    }
}

// ── PR Event Recording ──────────────────────────────────────

async function recordPrEvent(
    taskId: string,
    _eventType: string,
    comment: string,
): Promise<void> {
    try {
        const { addComment } = await import("@core/db/tasks");
        await addComment(taskId, `[PR] ${comment}`);
    } catch (e) {
        console.error(`[pr-lifecycle] failed to record event:`, e);
    }
}

// ── Polling Loop ────────────────────────────────────────────

/**
 * Single tick of the PR lifecycle poller.
 * Called from usePrLifecyclePoller hook.
 */
export async function prLifecycleTick(): Promise<void> {
    const settings = await getGlobalSettings();
    if (!settings.prLifecycleEnabled) return;

    const activePrs = await getTasksWithActivePr();
    if (activePrs.length === 0) return;

    const repos = await listRepositories();
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    const maxCycles = settings.maxReviewCycles ?? 5;

    for (const pr of activePrs) {
        const repo = repoMap.get(pr.repositoryId);
        if (!repo) continue;

        const task = await getTask(pr.id);
        if (!task) continue;

        try {
            await processTaskPr(task, repo.path, maxCycles);
        } catch (e) {
            console.error(`[pr-lifecycle] error processing ${pr.prUrl}:`, e);
        }
    }
}
