import { useEffect, useState } from 'react';

export function useDelayedLoading(isLoading: boolean, delayMs = 250): boolean {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setVisible(false);
            return;
        }
        const timer = setTimeout(() => setVisible(true), delayMs);
        return () => clearTimeout(timer);
    }, [isLoading, delayMs]);

    return isLoading && visible;
}
