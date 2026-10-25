import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Check, ChevronDown, Copy, Download } from 'lucide-react';
import { Tooltip } from './Tooltip';

// Action menu for the calendar feed. Shares the SelectField popup look; items take real focus.
export function CalendarMenu({ url, onCopyError }: { url: string; onCopyError: () => void }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [position, setPosition] = useState<CSSProperties>({});
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const id = useId();

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
            setPosition({
                position: 'fixed',
                top: rect.bottom + 4,
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                width,
            });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        const outside = (event: PointerEvent) => {
            if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);

    useEffect(() => () => clearTimeout(timer.current), []);

    const close = (refocus: boolean) => {
        setOpen(false);
        if (refocus) trigger.current?.focus();
    };
    const copy = async () => {
        close(true);
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            onCopyError();
        }
    };
    const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        } else if (event.key === 'Tab') {
            close(false);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next =
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        }
    };
    const triggerKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
        }
    };

    return (
        <>
            <Tooltip content="Calendar feed for your watched teams" placement="below">
                <button
                    ref={trigger}
                    type="button"
                    className="menu-trigger"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-controls={open ? id : undefined}
                    onClick={() => setOpen((value) => !value)}
                    onKeyDown={triggerKeys}
                >
                    {copied ? <Check size={16} aria-hidden="true" /> : <CalendarPlus size={16} aria-hidden="true" />}
                    {copied ? 'Copied' : 'Calendar'}
                    <ChevronDown size={16} aria-hidden="true" />
                </button>
            </Tooltip>
            <span className="sr-only" role="status">
                {copied ? 'Calendar link copied' : ''}
            </span>
            {open &&
                createPortal(
                    <div
                        className="select-popup menu-popup"
                        ref={panel}
                        id={id}
                        role="menu"
                        aria-label="Calendar"
                        style={position}
                        onKeyDown={menuKeys}
                    >
                        <a
                            role="menuitem"
                            className="select-option menu-item"
                            href={url}
                            download="team-scoreboard.ics"
                            onClick={() => close(false)}
                        >
                            <Download size={16} aria-hidden="true" />
                            <span>Download</span>
                        </a>
                        <button
                            type="button"
                            role="menuitem"
                            className="select-option menu-item"
                            onClick={() => void copy()}
                        >
                            <Copy size={16} aria-hidden="true" />
                            <span>Copy link</span>
                        </button>
                        <a
                            role="menuitem"
                            className="select-option menu-item"
                            href={url.replace(/^https:/, 'webcal:')}
                            onClick={() => close(false)}
                        >
                            <CalendarPlus size={16} aria-hidden="true" />
                            <span>Subscribe</span>
                        </a>
                    </div>,
                    document.body
                )}
        </>
    );
}
