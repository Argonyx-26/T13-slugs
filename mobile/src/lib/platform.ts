import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();

const IMPACT = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };

/** A short haptic tick (falls back to navigator.vibrate in the browser). Never throws. */
export function tap(strength: keyof typeof IMPACT = 'light') {
  Haptics.impact({ style: IMPACT[strength] }).catch(() => {});
}

export function buzzSuccess() {
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function buzzError() {
  Haptics.notification({ type: NotificationType.Error }).catch(() => {});
}

/** Keep the screen on while a consultation is being recorded: a locked phone stops the mic. */
export function keepScreenOn() {
  KeepAwake.keepAwake().catch(() => {});
}

export function allowScreenOff() {
  KeepAwake.allowSleep().catch(() => {});
}
