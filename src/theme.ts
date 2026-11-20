import { useEffect, useState } from 'react';

export type Theme = 'midnight' | 'light' | 'system';
export type ResolvedTheme = Exclude<Theme, 'system'>;
export function useTheme() {
    const [theme, setTheme] = useState<Theme>(() => {
        try {
            const saved = localStorage.getItem('team-scoreboard-theme');
            if (saved === 'light' || saved === 'system') return saved;
        } catch (error) {
            console.warn('Theme storage unavailable.', error);
        }
        return 'midnight';
    });
    const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
    const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'midnight' : 'light') : theme;
    useEffect(() => {
        const media = matchMedia('(prefers-color-scheme: dark)');
        const syncSystem = () => setSystemDark(media.matches);
        media.addEventListener('change', syncSystem);
        syncSystem();
        return () => media.removeEventListener('change', syncSystem);
    }, []);
    useEffect(() => {
        const dark = resolvedTheme === 'midnight';
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.classList.toggle('theme-midnight', dark);
        document.documentElement.classList.toggle('light', !dark);
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        document.documentElement.style.backgroundColor = dark ? '#0f172a' : '#ffffff';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#ffffff');
        document.querySelector('link[rel="icon"]')?.setAttribute('href', dark ? '/favicon.svg' : '/favicon-light.svg');
        document
            .querySelector('link[rel="apple-touch-icon"]')
            ?.setAttribute('href', dark ? '/apple-touch-icon.png' : '/apple-touch-icon-light.png');
    }, [resolvedTheme]);
    useEffect(() => {
        try {
            localStorage.setItem('team-scoreboard-theme', theme);
        } catch (error) {
            console.warn('Theme preference could not be saved.', error);
        }
    }, [theme]);
    return { theme, setTheme, resolvedTheme };
}
