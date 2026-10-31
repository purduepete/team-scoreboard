import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Theme script is missing');

describe('pre-paint theme', () => {
    it('runs before the font stylesheet', () => {
        const theme = html.indexOf('<script>');
        const font = html.indexOf('https://fonts.googleapis.com/css2');
        expect(theme).toBeGreaterThanOrEqual(0);
        expect(font).toBeGreaterThan(theme);
    });

    it.each([
        { saved: null, dark: false, expected: '#020617' },
        { saved: 'midnight', dark: false, expected: '#020617' },
        { saved: 'light', dark: true, expected: '#ffffff' },
        { saved: 'system', dark: true, expected: '#020617' },
        { saved: 'system', dark: false, expected: '#ffffff' },
    ])('sets the backdrop for $saved with system dark=$dark', ({ saved, dark, expected }) => {
        const root = { className: '', style: { colorScheme: '', backgroundColor: '' } };
        const meta = { content: '' };
        runInNewContext(script, {
            document: { documentElement: root, querySelector: () => meta },
            localStorage: { getItem: () => saved },
            matchMedia: () => ({ matches: dark }),
            console,
        });
        expect(root.style.backgroundColor).toBe(expected);
        expect(root.style.colorScheme).toBe(expected === '#ffffff' ? 'light' : 'dark');
        expect(meta.content).toBe(expected);
    });
});
