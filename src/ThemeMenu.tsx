import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Tooltip } from './Tooltip';
import type { Theme } from './theme';

const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'midnight', label: 'Midnight', Icon: Moon },
    { value: 'system', label: 'System', Icon: Monitor },
];

export function ThemeMenu({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const active = options.findIndex((option) => option.value === theme);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!container.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        requestAnimationFrame(() =>
            container.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus()
        );
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);

    const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
            return;
        }
        const offset = ['ArrowRight', 'ArrowDown'].includes(event.key)
            ? 1
            : ['ArrowLeft', 'ArrowUp'].includes(event.key)
              ? -1
              : 0;
        if (!offset) return;
        event.preventDefault();
        const next = options[(active + offset + options.length) % options.length].value;
        setTheme(next);
        requestAnimationFrame(() =>
            container.current?.querySelector<HTMLButtonElement>(`[data-theme-option="${next}"]`)?.focus()
        );
    };

    return (
        <div className="theme-menu" ref={container}>
            <Tooltip content="Appearance">
                <button
                    ref={trigger}
                    type="button"
                    className="icon-button"
                    aria-label="Appearance"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen((current) => !current)}
                >
                    <Palette size={18} aria-hidden="true" />
                </button>
            </Tooltip>
            {open && (
                <div className="theme-popover" role="dialog" aria-label="Appearance settings" onKeyDown={handleKeys}>
                    <span className="theme-popover-label">Theme</span>
                    <div className="tabs theme-pill" role="radiogroup" aria-label="Theme" data-active={active}>
                        {options.map(({ value, label, Icon }) => (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                data-theme-option={value}
                                aria-checked={theme === value}
                                tabIndex={theme === value ? 0 : -1}
                                onClick={() => setTheme(value)}
                            >
                                <Icon size={15} aria-hidden="true" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
