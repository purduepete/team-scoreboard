import { describe, expect, it } from 'vitest';
import { isAppleTouchDevice } from '../src/device';

describe('Apple touch device detection', () => {
    it.each([
        {
            label: 'Windows desktop',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
            platform: 'Win32',
            maxTouchPoints: 0,
            ios: false,
        },
        {
            label: 'Mac desktop',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            platform: 'MacIntel',
            maxTouchPoints: 0,
            ios: false,
        },
        {
            label: 'iPhone',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
            platform: 'iPhone',
            maxTouchPoints: 5,
            ios: true,
        },
        {
            label: 'iPad desktop identity',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            platform: 'MacIntel',
            maxTouchPoints: 5,
            ios: true,
        },
    ])('returns $ios on $label', ({ ios, label: _label, ...device }) => {
        expect(isAppleTouchDevice(device)).toBe(ios);
    });
});
