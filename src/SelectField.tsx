import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface Option {
    value: string;
    label: string;
}

// Adapted from Web Portfolio's SelectField: body portal and trigger-held keyboard focus.
export function SelectField({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [position, setPosition] = useState<CSSProperties>({});
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const id = useId();
    const chosen = options.find((option) => option.value === value);

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
            const below = window.innerHeight - rect.bottom;
            const up = below < 180 && rect.top > below;
            setPosition({
                position: 'fixed',
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                width,
                maxHeight: Math.max(48, Math.min(280, (up ? rect.top : below) - 12)),
                ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
            });
        };
        place();
        const scroll = (event: Event) => {
            if (!panel.current?.contains(event.target as Node)) place();
        };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', scroll, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', scroll, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);

    // Scroll only the popup. scrollIntoView can run before the popup is positioned and scroll the whole page.
    useEffect(() => {
        const list = panel.current;
        const option = open ? document.getElementById(`${id}-${active}`) : null;
        if (!list || !option) return;
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
            list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }, [active, id, open]);

    const show = () => {
        setActive(
            Math.max(
                0,
                options.findIndex((option) => option.value === value)
            )
        );
        setOpen(true);
    };
    const select = (index: number) => {
        const option = options[index];
        if (option) onChange(option.value);
        setOpen(false);
        trigger.current?.focus();
    };
    const keydown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Tab' || event.key === 'Escape') {
            setOpen(false);
            if (event.key === 'Escape') event.preventDefault();
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (!open) {
            show();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') select(active);
        else if (event.key === 'Home') setActive(0);
        else if (event.key === 'End') setActive(Math.max(0, options.length - 1));
        else
            setActive(
                (previous) => (previous + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            );
    };
    return (
        <div className="select-field">
            <span className="control-label">{label}</span>
            <button
                ref={trigger}
                type="button"
                className="select-trigger"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-activedescendant={open ? `${id}-${active}` : undefined}
                onClick={() => (open ? setOpen(false) : show())}
                onKeyDown={keydown}
            >
                <span>{chosen?.label ?? 'Choose'}</span>
                <ChevronDown size={16} aria-hidden="true" />
            </button>
            {open &&
                createPortal(
                    <div
                        className="select-popup"
                        ref={panel}
                        id={id}
                        role="listbox"
                        aria-label={label}
                        style={position}
                    >
                        {options.map((option, index) => (
                            <div
                                key={option.value}
                                id={`${id}-${index}`}
                                role="option"
                                aria-selected={option.value === value}
                                className={`select-option ${index === active ? 'active' : ''}`}
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => select(index)}
                            >
                                <span>{option.label}</span>
                                {option.value === value && <Check size={16} aria-hidden="true" />}
                            </div>
                        ))}
                    </div>,
                    document.body
                )}
        </div>
    );
}
