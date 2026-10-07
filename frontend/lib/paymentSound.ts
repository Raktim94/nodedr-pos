// "Soundbox"-style payment confirmation: a short two-tone chime plus a spoken
// "Payment received" line, played on the till when the cashier completes a
// sale. Entirely in the browser (Web Audio + speech synthesis) — no hardware,
// no network. The on/off choice is a per-device convenience kept in localStorage.
const KEY = "nodedr-pos-payment-sound";

export function paymentSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPaymentSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked — the choice just won't persist
  }
}

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.16;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // Audio blocked or unsupported — the on-screen confirmation still shows.
  }
}

export function playPaymentConfirmation(amountText: string, speak: boolean) {
  if (!paymentSoundEnabled()) return;
  chime();
  if (!speak) return;
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(`Payment received. ${amountText}`);
    u.rate = 0.95;
    setTimeout(() => window.speechSynthesis.speak(u), 450);
  } catch {
    // no speech voices — chime alone is fine
  }
}
