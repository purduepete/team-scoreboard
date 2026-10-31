// iPhone, iPod and iPad, including iPads that report a desktop Mac identity.
export function isAppleTouchDevice(
    device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator
): boolean {
    return /iPad|iPhone|iPod/.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1);
}
