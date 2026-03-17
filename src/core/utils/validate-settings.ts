import { validateBranchName } from "@core/utils/branch";
import type { GlobalSettings, ProjectOverrides } from "@core/types/settings";

const HH_MM_RE = /^\d{2}:\d{2}$/;

const MAX_TEXT_LENGTH = 2000;

// ── Helpers ─────────────────────────────────────────────────

function isValidTime(value: string): boolean {
    if (!HH_MM_RE.test(value)) return false;
    const [h, m] = value.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function isValidBudgetPercent(value: unknown): boolean {
    return typeof value === "number" && value >= 0 && value <= 100;
}

function isValidBranchPrefix(value: string): boolean {
    if (value === "") return true; // empty is allowed (user can clear)
    // Prefix becomes "value/" in the branch name — validate the prefix part
    return validateBranchName(`${value}/x`) === undefined;
}

function isValidTextLength(value: unknown): boolean {
    return typeof value !== "string" || value.length <= MAX_TEXT_LENGTH;
}

// ── Public validators ───────────────────────────────────────

/**
 * Validate a global setting value before persisting.
 * Throws an Error with a descriptive message if invalid.
 */
export function validateGlobalSetting(
    key: keyof GlobalSettings,
    value: unknown,
): void {
    switch (key) {
        case "scheduleStart":
        case "scheduleEnd":
            if (typeof value !== "string" || !isValidTime(value)) {
                throw new Error(
                    `Invalid time "${String(value)}" for ${key}. Use HH:MM format (00:00–23:59).`,
                );
            }
            break;

        case "budgetCeilingPercent":
            if (!isValidBudgetPercent(value)) {
                throw new Error(
                    `Budget ceiling must be a number between 0 and 100, got ${String(value)}.`,
                );
            }
            break;

        case "branchPrefixCustom":
            if (typeof value === "string" && !isValidBranchPrefix(value)) {
                throw new Error(
                    `Invalid branch prefix "${value}". ${validateBranchName(`${value}/x`) ?? "Contains invalid characters."}`,
                );
            }
            break;

        case "defaultBaseBranch":
            if (typeof value === "string" && value.trim() !== "") {
                const branchError = validateBranchName(value);
                if (branchError) {
                    throw new Error(
                        `Invalid base branch "${value}". ${branchError}`,
                    );
                }
            }
            break;
    }
}

/**
 * Validate a project override value before persisting.
 * Throws an Error with a descriptive message if invalid.
 */
export function validateProjectOverride(
    field: keyof Omit<ProjectOverrides, "repositoryId">,
    value: unknown,
): void {
    // null/undefined means "clear the override" — always valid
    if (value === null || value === undefined) return;

    switch (field) {
        case "overrideBudgetCeilingPercent":
            if (!isValidBudgetPercent(value)) {
                throw new Error(
                    `Budget ceiling must be a number between 0 and 100.`,
                );
            }
            break;

        case "overrideBranchPrefixCustom":
            if (typeof value === "string" && !isValidBranchPrefix(value)) {
                throw new Error(
                    `Invalid branch prefix "${value}". ${validateBranchName(`${value}/x`) ?? "Contains invalid characters."}`,
                );
            }
            break;

        case "overrideBaseBranch":
            if (typeof value === "string" && value.trim() !== "") {
                const branchError = validateBranchName(value);
                if (branchError) {
                    throw new Error(
                        `Invalid base branch "${value}". ${branchError}`,
                    );
                }
            }
            break;

        case "agentPreferences":
        case "scanPreferences":
            if (!isValidTextLength(value)) {
                throw new Error(
                    `${field === "agentPreferences" ? "Agent preferences" : "Scan preferences"} must be ${MAX_TEXT_LENGTH} characters or fewer.`,
                );
            }
            break;
    }
}

/**
 * Validate agent config schedule window times before persisting.
 * Throws an Error with a descriptive message if invalid.
 */
export function validateScheduleWindow(
    field: "scheduleWindowStart" | "scheduleWindowEnd",
    value: unknown,
): void {
    if (value === undefined || value === null) return;

    if (typeof value !== "string" || !isValidTime(value)) {
        throw new Error(
            `Invalid time for ${field}. Use HH:MM format (00:00–23:59).`,
        );
    }
}
