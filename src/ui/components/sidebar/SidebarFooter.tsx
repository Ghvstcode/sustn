import { useAuthStore } from "@core/store/auth-store";
import { Settings } from "lucide-react";

export function SidebarFooter() {
    const user = useAuthStore((s) => s.user);

    return (
        <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-2.5">
                {user?.avatarUrl ? (
                    <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="h-7 w-7 rounded-full"
                    />
                ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                        {user?.username?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                )}
                <span className="flex-1 truncate text-sm text-sidebar-foreground/80">
                    {user?.username ?? "User"}
                </span>
                <button
                    type="button"
                    className="rounded-md p-1 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                >
                    <Settings className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
