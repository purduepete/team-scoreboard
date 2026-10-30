import { useDelayedLoading } from './useDelayedLoading';

export function LoadingSpinner({ label = 'Loading', small = false }: { label?: string; small?: boolean }) {
    const visible = useDelayedLoading(true);
    if (!visible) return null;
    return (
        <span className="loading-entrance" role="status">
            <span className={`loading-spinner spin${small ? ' loading-spinner--small' : ''}`} aria-hidden="true" />
            <span className="sr-only">{label}</span>
        </span>
    );
}
