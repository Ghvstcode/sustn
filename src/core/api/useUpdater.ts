import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { updateAvailableToast } from "@ui/lib/toast";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Checks for app updates on mount and every hour.
 * Shows a toast when a new version is available.
 */
export function useUpdateChecker() {
    const checkedRef = useRef(false);

    useEffect(() => {
        async function checkForUpdate() {
            try {
                const update = await check();
                if (!update) return;

                updateAvailableToast(update.version, () => {
                    void update.downloadAndInstall().then(() => relaunch());
                });
            } catch (e) {
                // Silently ignore — network errors, dev mode, etc.
                console.debug("Update check failed:", e);
            }
        }

        // Check once on mount (with a small delay so the app finishes loading)
        if (!checkedRef.current) {
            checkedRef.current = true;
            const initialTimeout = setTimeout(
                () => void checkForUpdate(),
                5000,
            );

            // Then check periodically
            const interval = setInterval(
                () => void checkForUpdate(),
                CHECK_INTERVAL_MS,
            );

            return () => {
                clearTimeout(initialTimeout);
                clearInterval(interval);
            };
        }
    }, []);
}
