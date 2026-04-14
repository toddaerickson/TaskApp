import { Platform, Vibration } from 'react-native';

let audioCtx: any = null;

/** Plays a short beep. Web: Web Audio. Native: vibrate (no sound without expo-av). */
export function beep(times = 1, freq = 880) {
  if (Platform.OS === 'web') {
    try {
      const AC = (typeof window !== 'undefined' && ((window as any).AudioContext || (window as any).webkitAudioContext));
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      const ctx = audioCtx;
      let t = ctx.currentTime;
      for (let i = 0; i < times; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(ctx.destination);
        const start = t;
        const end = start + 0.18;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.start(start);
        o.stop(end);
        t = end + 0.08;
      }
    } catch {
      // audio blocked (autoplay policy) — ignore silently
    }
  } else {
    const pattern = Array(times).fill(0).flatMap(() => [0, 200, 150]);
    Vibration.vibrate(pattern);
  }
}
