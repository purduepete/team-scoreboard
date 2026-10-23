import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: '*.spec.ts',
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:5181', channel: 'msedge' },
    webServer: {
        command: 'npm run dev -- --port 5181',
        url: 'http://127.0.0.1:5181',
        reuseExistingServer: false,
    },
});
