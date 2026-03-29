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
 * Classify PR comments as actionable or conversational.
 *
 * Default: actionable. A reviewer comments because they want something.
 * Only mark as conversational if it's clearly praise, acknowledgment,
 * or a simple "nit" the reviewer flagged as optional.
 */
function classifyCommentsHeuristic(
    comments: GhPrComment[],
): ClassificationResult[] {
    return comments.map((c) => {
        const body = c.body.trim();

        // Clearly conversational — pure praise or acknowledgment
        const isPraise =
            /^(nice|great|good|looks good|lgtm|awesome|perfect|love it|well done|👍|🎉|💯|✅)\s*[.!]?$/i.test(
                body,
            );

        // Explicitly optional nits
        const isNit = /^nit[:\s]/i.test(body) || /^optional[:\s]/i.test(body);

        // Very short generic acknowledgments
        const isAck =
            body.length < 20 &&
            /^(thanks|thank you|ok|okay|got it|makes sense|agreed|fair enough|sure|yep|yes|no worries)\s*[.!]?$/i.test(
                body,
            );

        if (isPraise || isAck) {
            return {
                commentId: c.id,
                classification: "conversational" as const,
                reply: "Thanks!",
            };
        }

        if (isNit) {
            return {
                commentId: c.id,
                classification: "conversational" as const,
                reply: "Good catch, noted!",
            };
        }

        // Everything else is actionable — questions about the code,
        // suggestions, concerns, "why did you...", "this doesn't...",
        // "should we...", etc. all warrant the agent addressing them.
        return {
            commentId: c.id,
            classification: "actionable" as const,
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
    console.log(
        `[pr-lifecycle] fetching PR status: ${owner}/${repo}#${prNumber}`,
    );
    let prStatus;
    try {
        prStatus = await getPrStatus(repoPath, owner, repo, prNumber);
        console.log(`[pr-lifecycle] PR status:`, {
            state: prStatus.state,
            merged: prStatus.merged,
            reviewDecision: prStatus.reviewDecision,
        });
    } catch (e) {
        console.error(`[pr-lifecycle] failed to get PR status:`, e);
        return;
    }

    if (prStatus.merged) {
        console.log(`[pr-lifecycle] PR #${prNumber} merged!`);
        await updateTask(task.id, {
            prState: "merged" as PrState,
            state: "done",
            completedAt: new Date().toISOString(),
        });
        await recordPrEvent(task.id, "pr_merged", `PR #${prNumber} merged`);
        return;
    }

    if (prStatus.state === "closed") {
        console.log(`[pr-lifecycle] PR #${prNumber} closed without merge`);
        await updateTask(task.id, {
            prState: "merged" as PrState,
            state: "done",
            completedAt: new Date().toISOString(),
        });
        return;
    }

    // 2. Fetch reviews
    console.log(`[pr-lifecycle] fetching reviews for PR #${prNumber}`);
    let reviews: GhPrReview[];
    try {
        reviews = await listPrReviews(repoPath, owner, repo, prNumber);
        console.log(
            `[pr-lifecycle] found ${reviews.length} review(s):`,
            reviews.map((r) => ({
                reviewer: r.user.login,
                state: r.state,
                submitted: r.submitted_at,
            })),
        );
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

    // 4a. Always sync comments regardless of review state
    console.log(`[pr-lifecycle] fetching comments for PR #${prNumber}`);
    let ghComments: GhPrComment[];
    try {
        ghComments = await listPrComments(repoPath, owner, repo, prNumber);
    } catch (e) {
        console.error(`[pr-lifecycle] failed to fetch comments:`, e);
        ghComments = [];
    }

    // Get existing DB comments so we can identify our own replies
    const existingDbComments = await listComments(task.id);
    const ourReplyBodies = new Set(
        existingDbComments
            .filter((c) => c.ourReply)
            .map((c) => c.ourReply!.trim()),
    );

    // Filter out comments that are our own replies (posted from SUSTN)
    const externalComments = ghComments.filter((c) => {
        // Skip replies where the body matches something we posted
        if (c.in_reply_to_id && ourReplyBodies.has(c.body.trim())) {
            console.log(
                `[pr-lifecycle] skipping our own reply (comment ${c.id})`,
            );
            return false;
        }
        return true;
    });

    console.log(
        `[pr-lifecycle] PR #${prNumber} — ${ghComments.length} total comment(s), ${externalComments.length} external`,
    );

    // Sync external comments to DB
    for (const comment of externalComments) {
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

    // 4b. Classify any new top-level external comments that haven't been classified
    const refreshedDbComments = await listComments(task.id);
    const unclassified = externalComments.filter((c) => {
        if (c.in_reply_to_id != null) return false; // Skip replies
        const dbEntry = refreshedDbComments.find(
            (d) => d.githubCommentId === c.id,
        );
        return dbEntry && !dbEntry.classification;
    });

    if (unclassified.length > 0) {
        console.log(
            `[pr-lifecycle] classifying ${unclassified.length} new comment(s)`,
        );
        const classifications = classifyCommentsHeuristic(unclassified);
        for (const cls of classifications) {
            await updateCommentClassification(
                cls.commentId,
                cls.classification,
            );
        }
    }

    // 5. Handle unaddressed comments — regardless of formal review state
    //    Comments are actionable even without a CHANGES_REQUESTED review.
    const hasUnaddressedActionable = refreshedDbComments.some(
        (c) =>
            c.classification === "actionable" &&
            !c.addressedInCommit &&
            !c.inReplyToId,
    );
    const hasUnrepliedConversational = refreshedDbComments.some(
        (c) =>
            c.classification === "conversational" &&
            !c.ourReply &&
            !c.inReplyToId,
    );

    if (task.prState === "opened") {
        await updateTask(task.id, { prState: "in_review" as PrState });
    }

    // Process comments if there are any to handle, regardless of review state
    if (
        (hasUnaddressedActionable || hasUnrepliedConversational) &&
        !latestReview
    ) {
        console.log(
            `[pr-lifecycle] PR #${prNumber} — no formal review but has comments to process (actionable=${hasUnaddressedActionable}, conversational=${hasUnrepliedConversational})`,
        );
        // Fall through to the comment handling below
    } else if (!latestReview) {
        console.log(
            `[pr-lifecycle] PR #${prNumber} — no reviews, no unprocessed comments`,
        );
        return;
    }

    // 6. Handle approved
    if (latestReview?.state === "APPROVED") {
        console.log(
            `[pr-lifecycle] PR #${prNumber} approved by @${latestReview.user.login}`,
        );
        await updateTask(task.id, {
            prState: "approved" as PrState,
            state: "done",
            completedAt: new Date().toISOString(),
        });
        await recordPrEvent(
            task.id,
            "pr_approved",
            `@${latestReview.user.login} approved the PR`,
        );
        return;
    }

    // 7. Handle changes requested (formal review) — update state + cycle count
    if (latestReview?.state === "CHANGES_REQUESTED") {
        if (
            task.prState === "addressing" ||
            task.prState === "re_review_requested"
        ) {
            const latestDbReviewTime =
                refreshedDbComments.length > 0
                    ? Math.max(
                          ...refreshedDbComments.map((c) =>
                              new Date(c.createdAt).getTime(),
                          ),
                      )
                    : 0;
            const reviewTime = new Date(latestReview.submitted_at).getTime();
            if (reviewTime <= latestDbReviewTime) return;
        }

        if (task.prReviewCycles >= maxReviewCycles) {
            console.log(
                `[pr-lifecycle] PR #${prNumber} — max review cycles (${maxReviewCycles}) reached`,
            );
            await updateTask(task.id, {
                prState: "needs_human_attention" as PrState,
                lastError: `Reviewer requested changes ${task.prReviewCycles} times — needs human review`,
            });
            await recordPrEvent(
                task.id,
                "pr_needs_human",
                `Max review cycles (${maxReviewCycles}) reached`,
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
    }

    // 8. Handle conversational comments — auto-reply
    const conversationalToReply = refreshedDbComments.filter(
        (c) =>
            c.classification === "conversational" &&
            !c.ourReply &&
            !c.inReplyToId,
    );

    for (const conv of conversationalToReply) {
        const classResult = classifyCommentsHeuristic([
            {
                id: conv.githubCommentId,
                user: { login: conv.reviewer },
                body: conv.body,
                path: conv.path ?? null,
                line: conv.line ?? null,
                side: conv.side ?? null,
                original_line: null,
                commit_id: null,
                in_reply_to_id: null,
                created_at: conv.createdAt,
                updated_at: conv.createdAt,
            },
        ]);
        const reply = classResult[0]?.reply ?? "Thanks for the feedback!";

        try {
            await replyToComment(
                repoPath,
                owner,
                repo,
                prNumber,
                conv.githubCommentId,
                reply,
            );
            await setCommentReply(conv.githubCommentId, reply);
            console.log(
                `[pr-lifecycle] replied to conversational comment ${conv.githubCommentId}: "${reply}"`,
            );
        } catch (e) {
            console.error(
                `[pr-lifecycle] failed to reply to comment ${conv.githubCommentId}:`,
                e,
            );
        }
    }

    // 9. Handle actionable comments — address via agent
    const actionableComments = refreshedDbComments.filter(
        (c) =>
            c.classification === "actionable" &&
            !c.addressedInCommit &&
            !c.inReplyToId,
    );

    if (actionableComments.length > 0) {
        console.log(
            `[pr-lifecycle] ${actionableComments.length} actionable comment(s) — spinning up agent`,
        );
        await updateTask(task.id, { prState: "addressing" as PrState });

        const reviewContext = actionableComments
            .map((c) => {
                const location = c.path
                    ? `File: ${c.path}${c.line ? `:${c.line}` : ""}`
                    : "General";
                return `[${location}] @${c.reviewer}: ${c.body}`;
            })
            .join("\n\n");

        try {
            const result = await invoke<WorkResult>("engine_address_review", {
                taskId: task.id,
                repositoryId: task.repositoryId,
                repoPath,
                branchName: task.branchName,
                baseBranch: task.baseBranch ?? "main",
                reviewComments: reviewContext,
                prDescription: task.description ?? task.title,
            });

            if (result.success) {
                const pushResult = await invoke<{
                    success: boolean;
                    error?: string;
                }>("engine_push_branch", {
                    repoPath,
                    branchName: task.branchName,
                });

                if (pushResult.success) {
                    for (const c of actionableComments) {
                        await markCommentAddressed(
                            c.githubCommentId,
                            result.commitSha ?? "",
                        );
                    }

                    const summary =
                        result.summary ?? "Addressed review comments";
                    await postPrComment(
                        repoPath,
                        owner,
                        repo,
                        prNumber,
                        `I've addressed the review feedback:\n\n${summary}\n\nCommit: ${result.commitSha ?? "latest"}`,
                    );

                    // Re-request review if we know who reviewed
                    const reviewer = latestReview?.user.login;
                    if (reviewer) {
                        try {
                            await requestReview(
                                repoPath,
                                owner,
                                repo,
                                prNumber,
                                [reviewer],
                            );
                        } catch (e) {
                            console.warn(
                                `[pr-lifecycle] re-request review failed:`,
                                e,
                            );
                        }
                    }

                    await updateTask(task.id, {
                        prState: "re_review_requested" as PrState,
                        commitSha: result.commitSha,
                    });
                    await recordPrEvent(
                        task.id,
                        "pr_comment_addressed",
                        `Agent pushed commit ${result.commitSha?.slice(0, 7) ?? "?"} addressing ${actionableComments.length} comment(s)`,
                    );
                } else {
                    console.error(
                        `[pr-lifecycle] push failed:`,
                        pushResult.error,
                    );
                    await updateTask(task.id, {
                        prState: "in_review" as PrState,
                        lastError: `Failed to push changes: ${pushResult.error}`,
                    });
                }
            } else {
                console.error(
                    `[pr-lifecycle] address review failed:`,
                    result.error,
                );
                await updateTask(task.id, {
                    prState: "in_review" as PrState,
                    lastError: result.error ?? "Failed to address review",
                });
            }
        } catch (e) {
            console.error(`[pr-lifecycle] address review error:`, e);
            await updateTask(task.id, {
                prState: "in_review" as PrState,
                lastError: e instanceof Error ? e.message : String(e),
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
    if (!settings.prLifecycleEnabled) {
        console.log("[pr-lifecycle] tick — disabled in settings, skipping");
        return;
    }

    console.log("[pr-lifecycle] tick — checking for active PRs...");

    // First, backfill any tasks that have a pr_url but no pr_state/pr_number
    await backfillPrState();

    const activePrs = await getTasksWithActivePr();
    console.log(
        `[pr-lifecycle] tick — found ${activePrs.length} active PR(s)`,
        activePrs.map((p) => ({
            id: p.id.slice(0, 8),
            prState: p.prState,
            prNumber: p.prNumber,
        })),
    );
    if (activePrs.length === 0) return;

    const repos = await listRepositories();
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    const maxCycles = settings.maxReviewCycles ?? 5;

    for (const pr of activePrs) {
        const repo = repoMap.get(pr.repositoryId);
        if (!repo) {
            console.log(
                `[pr-lifecycle] skipping PR ${pr.prNumber} — repo ${pr.repositoryId} not found`,
            );
            continue;
        }

        const task = await getTask(pr.id);
        if (!task) {
            console.log(
                `[pr-lifecycle] skipping PR ${pr.prNumber} — task ${pr.id} not found`,
            );
            continue;
        }

        console.log(
            `[pr-lifecycle] processing PR #${pr.prNumber} (${task.title}) — prState=${task.prState}, repo=${repo.name}`,
        );

        try {
            await processTaskPr(task, repo.path, maxCycles);
        } catch (e) {
            console.error(`[pr-lifecycle] error processing ${pr.prUrl}:`, e);
        }
    }

    console.log("[pr-lifecycle] tick — done");
}

/**
 * Backfill pr_state and pr_number for tasks that have a pr_url
 * but were created before the lifecycle feature was wired in.
 */
async function backfillPrState(): Promise<void> {
    try {
        const { default: Database } = await import("@tauri-apps/plugin-sql");
        const { config } = await import("@core/config");
        const db = await Database.load(config.dbUrl);
        const rows = await db.select<{ id: string; pr_url: string }[]>(
            `SELECT id, pr_url FROM tasks
             WHERE pr_url IS NOT NULL
               AND pr_url != ''
               AND pr_state IS NULL`,
        );
        if (rows.length === 0) return;

        console.log(
            `[pr-lifecycle] backfilling ${rows.length} task(s) with pr_url but no pr_state`,
        );

        for (const row of rows) {
            const parsed = parseOwnerRepo(row.pr_url);
            if (!parsed) continue;
            await updateTask(row.id, {
                prState: "opened" as PrState,
                prNumber: parsed.number,
            });
            console.log(
                `[pr-lifecycle] backfilled task ${row.id.slice(0, 8)} — PR #${parsed.number}`,
            );
        }
    } catch (e) {
        console.error("[pr-lifecycle] backfill failed:", e);
    }
}
