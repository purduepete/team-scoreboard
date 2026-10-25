import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
    const anchor = useRef<HTMLSpanElement>(null);
    const tooltip = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0, above: true });
    const id = useId();

    useLayoutEffect(() => {
        const target =
            anchor.current?.querySelector<HTMLElement>('button, a, [tabindex], [role="img"]') ?? anchor.current;
        if (!target) return;
        const previous = target.getAttribute('aria-describedby');
        target.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
        return () => {
            if (previous) target.setAttribute('aria-describedby', previous);
            else target.removeAttribute('aria-describedby');
        };
    }, [id]);

    useEffect(() => () => clearTimeout(hideTimer.current), []);

    const reposition = () => {
        const target =
            anchor.current?.querySelector<HTMLElement>('button, a, [tabindex], [role="img"]') ?? anchor.current;
        const rect = target?.getBoundingClientRect();
        if (!rect) return;
        const box = tooltip.current?.getBoundingClientRect();
        const height = box?.height ?? 36;
        const above = rect.top >= height + 12;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - (box?.width ?? 280) - 8));
        setPosition({ top: above ? rect.top - 8 : rect.bottom + 8, left, above });
    };

    useLayoutEffect(() => {
        if (!open) return;
        reposition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        const dismiss = (event: PointerEvent) => {
            if (!anchor.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node))
                setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);

    const show = () => {
        if (window.matchMedia('(any-pointer: coarse)').matches) return;
        clearTimeout(hideTimer.current);
        setOpen(true);
    };
    const hide = () => {
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setOpen(false), 150);
    };

    return (
        <>
            <span
                ref={anchor}
                className="tooltip-anchor"
                onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') show();
                }}
                onPointerLeave={(event) => {
                    if (event.pointerType !== 'touch' && !anchor.current?.contains(document.activeElement)) hide();
                }}
                onFocusCapture={show}
                onBlurCapture={(event) => {
                    if (!anchor.current?.contains(event.relatedTarget as Node | null)) hide();
                }}
            >
                {children}
            </span>
            {createPortal(
                <div
                    ref={tooltip}
                    id={id}
                    role="tooltip"
                    className="custom-tooltip"
                    data-open={open}
                    style={{
                        top: position.top,
                        left: position.left,
                        transform: position.above ? 'translateY(-100%)' : undefined,
                    }}
                    onPointerEnter={() => clearTimeout(hideTimer.current)}
                    onPointerLeave={() => {
                        if (!anchor.current?.contains(document.activeElement)) hide();
                    }}
                >
                    {content}
                </div>,
                document.body
            )}
        </>
    );
}
