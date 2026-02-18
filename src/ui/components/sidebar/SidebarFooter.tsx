import { useAuthStore } from "@core/store/auth-store";
import { Settings } from "lucide-react";

export function SidebarFooter() {
    const user = useAuthStore((s) => s.user);

    return (
        <div className="border-t border-sidebar-border px-3 py-2.5">
            <div className="flex items-center gap-2">
                {user?.avatarUrl ? (
                    <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="h-5 w-5 rounded-full"
                    />
                ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sidebar-accent text-[9px] font-medium text-sidebar-accent-foreground">
                        {user?.username?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                )}
                <span className="flex-1 truncate text-[11px] text-sidebar-foreground">
                    {user?.username ?? "User"}
                </span>
                <button
                    type="button"
                    className="rounded p-0.5 text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                >
                    <Settings className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}
