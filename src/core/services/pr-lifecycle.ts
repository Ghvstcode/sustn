/**
 * PR Lifecycle Management Service
 *
 * Orchestrates the full lifecycle of PRs opened by SUSTN:
 *   opened → in_review → changes_requested → addressing → re_review_requested → approved → merged
 *
 * When new review comments arrive, sends ALL of them to Claude in a single
 * resumed session (preserving the original reasoning context). Claude handles
 * classification, code changes, and reply drafting in one pass.
 */

import { invoke } from "@tauri-apps/api/core";
import { updateTask, getTask } from "@core/db/tasks";
import {
    getTasksWithActivePr,
    upsertReview,
    upsertComment,
    listComments,
    markCommentAddressed,
    setCommentReply,
} from "@core/db/pr-lifecycle";
import {
    parseOwnerRepo,
    listPrReviews,
    listPrComments,
    getPrStatus,
    replyToComment,
    requestReview,
} from "@core/services/github";
import { listRepositories } from "@core/db/repositories";
import { getGlobalSettings } from "@core/db/settings";
import type { WorkResult } from "@core/types/agent";
import type { PrState, Task } from "@core/types/task";
import type { GhPrComment, GhPrReview } from "@core/services/github";

// ── Claude Response Parsing ─────────────────────────────────

interface ClaudeReviewReply {
    comment_id: number;
    reply: string;
    made_code_changes: boolean;
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

    const latestReview = reviews
        .filter((r) => r.state !== "COMMENTED")
        .sort(
            (a, b) =>
                new Date(b.submitted_at).getTime() -
                new Date(a.submitted_at).getTime(),
        )[0];

    // 4. Always sync comments regardless of review state
    console.log(`[pr-lifecycle] fetching comments for PR #${prNumber}`);
    let ghComments: GhPrComment[];
    try {
        ghComments = await listPrComments(repoPath, owner, repo, prNumber);
    } catch (e) {
        console.error(`[pr-lifecycle] failed to fetch comments:`, e);
        ghComments = [];
    }

    // Filter out our own replies
    const existingDbComments = await listComments(task.id);
    const ourReplyBodies = new Set(
        existingDbComments
            .filter((c) => c.ourReply)
            .map((c) => c.ourReply!.trim()),
    );

    const externalComments = ghComments.filter((c) => {
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

    // 5. Determine which comments need processing
    const refreshedDbComments = await listComments(task.id);
    const unprocessedComments = refreshedDbComments.filter(
        (c) => !c.ourReply && !c.addressedInCommit && !c.inReplyToId,
    );

    if (task.prState === "opened") {
        await updateTask(task.id, { prState: "in_review" as PrState });
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

    // 7. Handle changes requested — update cycle count
    if (latestReview?.state === "CHANGES_REQUESTED") {
        if (
            task.prState === "addressing" ||
            task.prState === "re_review_requested"
        ) {
            const latestDbTime =
                refreshedDbComments.length > 0
                    ? Math.max(
                          ...refreshedDbComments.map((c) =>
                              new Date(c.createdAt).getTime(),
                          ),
                      )
                    : 0;
            const reviewTime = new Date(latestReview.submitted_at).getTime();
            if (reviewTime <= latestDbTime) return;
        }

        if (task.prReviewCycles >= maxReviewCycles) {
            console.log(
                `[pr-lifecycle] PR #${prNumber} — max review cycles (${maxReviewCycles}) reached`,
            );
            await updateTask(task.id, {
                prState: "needs_human_attention" as PrState,
                lastError: `Reviewer requested changes ${task.prReviewCycles} times`,
            });
            return;
        }

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

    // 8. If no unprocessed comments, nothing for the agent to do
    if (unprocessedComments.length === 0) {
        console.log(`[pr-lifecycle] PR #${prNumber} — no unprocessed comments`);
        return;
    }

    // 9. Send ALL unprocessed comments to Claude in one session.
    //    Resume the original session so Claude has its reasoning context.
    //    Claude decides for each comment: fix code, explain reasoning, or thank.
    console.log(
        `[pr-lifecycle] PR #${prNumber} — ${unprocessedComments.length} comment(s) → sending to Claude${task.sessionId ? " (resuming session)" : " (fresh session)"}`,
    );
    await updateTask(task.id, { prState: "addressing" as PrState });

    const reviewContext = unprocessedComments
        .map((c) => {
            const location = c.path
                ? `File: ${c.path}${c.line ? `:${c.line}` : ""}`
                : "General";
            return `[COMMENT_ID: ${c.githubCommentId}] [${location}] @${c.reviewer}:\n${c.body}`;
        })
        .join("\n\n---\n\n");

    try {
        const result = await invoke<WorkResult>("engine_address_review", {
            taskId: task.id,
            repositoryId: task.repositoryId,
            repoPath,
            branchName: task.branchName,
            baseBranch: task.baseBranch ?? "main",
            reviewComments: reviewContext,
            prDescription: task.description ?? task.title,
            resumeSessionId: task.sessionId ?? undefined,
        });

        if (result.success) {
            console.log(
                `[pr-lifecycle] engine_address_review succeeded — summary length=${result.summary?.length ?? 0}, commitSha=${result.commitSha}, sessionId=${result.sessionId}`,
            );

            // Push any code changes
            const pushResult = await invoke<{
                success: boolean;
                error?: string;
            }>("engine_push_branch", {
                repoPath,
                branchName: task.branchName,
            });

            console.log(
                `[pr-lifecycle] push result: success=${pushResult.success}, error=${pushResult.error}`,
            );

            // Parse Claude's structured output for per-comment replies
            let replies: ClaudeReviewReply[] = [];
            try {
                const jsonMatch = result.summary?.match(
                    /\{[\s\S]*"replies"[\s\S]*\}/,
                );
                console.log(
                    `[pr-lifecycle] JSON match found: ${!!jsonMatch}, length=${jsonMatch?.[0]?.length ?? 0}`,
                );
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]) as {
                        replies?: ClaudeReviewReply[];
                    };
                    replies = parsed.replies ?? [];
                }
            } catch (parseErr) {
                console.error(
                    `[pr-lifecycle] could not parse structured replies:`,
                    parseErr,
                    `summary preview: ${result.summary?.slice(0, 200)}`,
                );
            }

            // Fix null comment_ids — if counts match, zip them
            for (let i = 0; i < replies.length; i++) {
                if (!replies[i].comment_id && i < unprocessedComments.length) {
                    replies[i].comment_id =
                        unprocessedComments[i].githubCommentId;
                    console.log(
                        `[pr-lifecycle] fixed null comment_id → ${replies[i].comment_id} (positional match)`,
                    );
                }
            }

            console.log(
                `[pr-lifecycle] Claude returned ${replies.length} reply(ies), push=${pushResult.success}`,
                replies.map((r) => ({
                    id: r.comment_id,
                    code: r.made_code_changes,
                    reply: r.reply?.slice(0, 60),
                })),
            );

            // Post replies to GitHub and update DB
            for (const r of replies) {
                if (!r.reply || !r.comment_id) continue;
                try {
                    await replyToComment(
                        repoPath,
                        owner,
                        repo,
                        prNumber,
                        r.comment_id,
                        r.reply,
                    );
                    await setCommentReply(r.comment_id, r.reply);

                    if (r.made_code_changes && result.commitSha) {
                        await markCommentAddressed(
                            r.comment_id,
                            result.commitSha,
                        );
                    }

                    console.log(
                        `[pr-lifecycle] replied to comment ${r.comment_id} (code_changes=${r.made_code_changes})`,
                    );
                } catch (e) {
                    console.error(
                        `[pr-lifecycle] failed to post reply for comment ${r.comment_id}:`,
                        e,
                    );
                }
            }

            // For any comments Claude didn't return a reply for, mark as addressed if code changed
            if (pushResult.success && result.commitSha) {
                for (const c of unprocessedComments) {
                    const hasReply = replies.some(
                        (r) => r.comment_id === c.githubCommentId,
                    );
                    if (!hasReply) {
                        await markCommentAddressed(
                            c.githubCommentId,
                            result.commitSha,
                        );
                    }
                }
            }

            // Per-comment replies already explain what was done — no need
            // for a separate summary comment on the PR thread.

            // Re-request review
            const reviewer = latestReview?.user.login;
            if (reviewer) {
                try {
                    await requestReview(repoPath, owner, repo, prNumber, [
                        reviewer,
                    ]);
                } catch {
                    // Not critical
                }
            }

            console.log(
                `[pr-lifecycle] all replies posted, updating state to re_review_requested`,
            );
            await updateTask(task.id, {
                prState: "re_review_requested" as PrState,
                commitSha: result.commitSha ?? task.commitSha,
                sessionId: result.sessionId ?? task.sessionId,
            });
            await recordPrEvent(
                task.id,
                "pr_comment_addressed",
                `Agent processed ${unprocessedComments.length} comment(s)${result.commitSha ? ` — commit ${result.commitSha.slice(0, 7)}` : ""}`,
            );
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
        // Always transition out of "addressing" even on error
        try {
            await updateTask(task.id, {
                prState: "in_review" as PrState,
                lastError: e instanceof Error ? e.message : String(e),
            });
        } catch (updateErr) {
            console.error(
                `[pr-lifecycle] CRITICAL: failed to update task state after error:`,
                updateErr,
            );
        }
    }
}

// ── PR Event Recording ──────────────────────────────────────

async function recordPrEvent(
    taskId: string,
    eventType: string,
    comment: string,
): Promise<void> {
    try {
        const { recordPublicEvent } = await import("@core/db/tasks");
        await recordPublicEvent(taskId, {
            eventType: "pr_event",
            field: eventType,
            comment,
        });
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

    // Backfill tasks with pr_url but no pr_state
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
                `[pr-lifecycle] skipping PR ${pr.prNumber} — repo not found`,
            );
            continue;
        }

        const task = await getTask(pr.id);
        if (!task) {
            console.log(
                `[pr-lifecycle] skipping PR ${pr.prNumber} — task not found`,
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
