import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a debounced version of the given callback.
 * The callback is invoked after `delay` ms of inactivity.
 * Pending invocations are flushed on unmount.
 */
export function useDebouncedCallback<Args extends unknown[]>(
    callback: (...args: Args) => void,
    delay: number,
): (...args: Args) => void {
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const callbackRef = useRef(callback);

    // Keep callback ref fresh without restarting the timer
    callbackRef.current = callback;

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== undefined) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return useCallback(
        (...args: Args) => {
            if (timeoutRef.current !== undefined) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                timeoutRef.current = undefined;
                callbackRef.current(...args);
            }, delay);
        },
        [delay],
    );
}
