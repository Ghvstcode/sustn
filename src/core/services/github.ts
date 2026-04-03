/**
 * GitHub API helpers for PR lifecycle management.
 * Uses the `gh` CLI via Tauri's invoke to interact with GitHub,
 * which inherits the user's auth — no separate token needed.
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types ───────────────────────────────────────────────────

export interface GhPrReview {
    id: number;
    user: { login: string };
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
    body: string;
    submitted_at: string;
}

export interface GhPrComment {
    id: number;
    user: { login: string };
    body: string;
    path: string | null;
    line: number | null;
    side: "LEFT" | "RIGHT" | null;
    original_line: number | null;
    commit_id: string | null;
    in_reply_to_id: number | null;
    created_at: string;
    updated_at: string;
}

export interface GhPrStatus {
    state: "open" | "closed" | "merged";
    merged: boolean;
    mergeable: string | null;
    reviewDecision: string | null;
}

// ── Helpers ─────────────────────────────────────────────────

/** Parse owner/repo from a GitHub PR URL */
export function parseOwnerRepo(
    prUrl: string,
): { owner: string; repo: string; number: number } | undefined {
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return undefined;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

/** Run a gh api command and return parsed JSON */
async function ghApi<T>(repoPath: string, endpoint: string): Promise<T> {
    const result = await invoke<{
        success: boolean;
        stdout: string;
        stderr: string;
    }>("run_gh_api", { repoPath, endpoint });
    if (!result.success) {
        throw new Error(`gh api failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as T;
}

/** Run a gh api command with POST body */
async function ghApiPost<T>(
    repoPath: string,
    endpoint: string,
    body: Record<string, unknown>,
): Promise<T> {
    const result = await invoke<{
        success: boolean;
        stdout: string;
        stderr: string;
    }>("run_gh_api_post", { repoPath, endpoint, body: JSON.stringify(body) });
    if (!result.success) {
        throw new Error(`gh api POST failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as T;
}

// ── PR Status ───────────────────────────────────────────────

export async function getPrStatus(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<GhPrStatus> {
    return ghApi<GhPrStatus>(
        repoPath,
        `repos/${owner}/${repo}/pulls/${prNumber}`,
    );
}

// ── Reviews ─────────────────────────────────────────────────

export async function listPrReviews(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<GhPrReview[]> {
    return ghApi<GhPrReview[]>(
        repoPath,
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    );
}

// ── Review Comments ─────────────────────────────────────────

export async function listPrComments(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<GhPrComment[]> {
    return ghApi<GhPrComment[]>(
        repoPath,
        `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    );
}

// ── Post Reply ──────────────────────────────────────────────

export async function replyToComment(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
): Promise<GhPrComment> {
    return ghApiPost<GhPrComment>(
        repoPath,
        `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
        { body },
    );
}

/** Post a top-level issue comment on the PR */
export async function postPrComment(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
): Promise<{ id: number }> {
    return ghApiPost<{ id: number }>(
        repoPath,
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        { body },
    );
}

// ── Re-request Review ───────────────────────────────────────

export async function requestReview(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[],
): Promise<void> {
    await ghApiPost(
        repoPath,
        `repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
        { reviewers },
    );
}

// ── Get diff of the PR ──────────────────────────────────────

export async function getPrDiff(
    repoPath: string,
    owner: string,
    repo: string,
    prNumber: number,
): Promise<string> {
    const result = await invoke<{
        success: boolean;
        stdout: string;
        stderr: string;
    }>("run_gh_api", {
        repoPath,
        endpoint: `repos/${owner}/${repo}/pulls/${prNumber}`,
        accept: "application/vnd.github.v3.diff",
    });
    if (!result.success) {
        throw new Error(`Failed to get PR diff: ${result.stderr}`);
    }
    return result.stdout;
}
