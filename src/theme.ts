import { useEffect, useState } from 'react';

export type Theme = 'midnight' | 'light' | 'system';
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
    useEffect(() => {
        const media = matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const dark = theme === 'midnight' || (theme === 'system' && media.matches);
            document.documentElement.classList.toggle('dark', dark);
            document.documentElement.classList.toggle('theme-midnight', dark);
            document.documentElement.classList.toggle('light', !dark);
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
            document.documentElement.style.backgroundColor = dark ? '#020617' : '#ffffff';
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#ffffff');
        };
        apply();
        try {
            localStorage.setItem('team-scoreboard-theme', theme);
        } catch (error) {
            console.warn('Theme preference could not be saved.', error);
        }
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [theme]);
    return { theme, setTheme };
}
