import type {
    BranchPrefixMode,
    BranchNameStyle,
    GlobalSettings,
    ProjectOverrides,
} from "@core/types/settings";

/**
 * Generate a git branch name from task data + user settings.
 *
 * Examples:
 *   slug style:       "sustn/fix-auth-middleware-error"
 *   short-hash style: "sustn/d23cd321"
 *   task-id style:    "sustn/task-d23cd321"
 */
export function generateBranchName(
    taskTitle: string,
    taskId: string,
    settings: GlobalSettings,
    overrides?: ProjectOverrides,
): string {
    const prefixMode: BranchPrefixMode =
        overrides?.overrideBranchPrefixMode ?? settings.branchPrefixMode;
    const prefixCustom: string =
        overrides?.overrideBranchPrefixCustom ?? settings.branchPrefixCustom;
    const nameStyle: BranchNameStyle = settings.branchNameStyle;

    const prefix =
        prefixMode === "sustn"
            ? "sustn/"
            : prefixMode === "custom"
              ? `${prefixCustom || "my"}/`
              : "";

    const shortId = taskId.slice(0, 8);

    let name: string;
    switch (nameStyle) {
        case "slug":
            name = slugify(taskTitle);
            break;
        case "short-hash":
            name = shortId;
            break;
        case "task-id":
            name = `task-${shortId}`;
            break;
        default:
            name = shortId;
    }

    return `${prefix}${name}`;
}

/**
 * Compute the effective base branch for a task, with fallback chain:
 * project override → task.baseBranch → global default → repo defaultBranch
 */
export function effectiveBaseBranch(
    taskBaseBranch: string | undefined,
    settings: GlobalSettings,
    overrides: ProjectOverrides | undefined,
    repoDefaultBranch: string,
): string {
    return (
        overrides?.overrideBaseBranch ||
        taskBaseBranch ||
        settings.defaultBaseBranch ||
        repoDefaultBranch
    );
}

/**
 * Validate a git branch name. Returns an error message if invalid, or
 * undefined if valid.
 */
export function validateBranchName(name: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) return "Branch name cannot be empty";
    if (/\s/.test(trimmed)) return "Branch name cannot contain spaces";
    if (trimmed.startsWith("-")) return "Branch name cannot start with a dash";
    if (trimmed.startsWith(".")) return "Branch name cannot start with a dot";
    if (trimmed.endsWith(".lock")) return 'Branch name cannot end with ".lock"';
    if (trimmed.endsWith(".")) return "Branch name cannot end with a dot";
    if (trimmed.includes("..")) return 'Branch name cannot contain ".."';
    if (/[~^:?*[\]\\]/.test(trimmed))
        return "Branch name contains invalid characters";
    if (trimmed.includes("@{")) return 'Branch name cannot contain "@{"';
    return undefined;
}

/** Convert a title to a git-safe slug (lowercase, dashes, max 60 chars). */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-") // non-alphanum → dash
        .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
        .slice(0, 60) // cap length
        .replace(/-+$/, ""); // trim if slice cut mid-word
}
