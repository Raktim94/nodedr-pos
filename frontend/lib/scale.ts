// Weighing-scale input over the Web Serial API (Chrome / Edge, secure
// context). Reads the weight a scale prints on its serial/USB-serial port
// (RS-232 or USB scales in serial mode) and returns kilograms.
//
// Not testable without hardware: parsing is unit-checked against the common
// line formats below; the port settings (baud rate) vary by scale model, so
// the baud rate is selectable in the UI. USB scales that present as HID
// keyboards need no code at all — they type the weight like a scanner.
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

export const scaleSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

// Handles: "ST,GS,   0.250kg", "  0.250 kg", "+000.250 g", "W: 1.05", "0.5\r".
export function parseWeightKg(text: string): number | null {
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /([+-]?\d+(?:\.\d+)?)\s*(kg|g|lb|oz)?\b/i.exec(lines[i].replace(/^(ST|US),(GS|NT),?/i, ""));
    if (!m) continue;
    let v = Number(m[1]);
    const unit = (m[2] || "kg").toLowerCase();
    if (unit === "g") v /= 1000;
    else if (unit === "lb") v *= 0.45359237;
    else if (unit === "oz") v *= 0.0283495;
    if (Number.isFinite(v) && v >= 0) return Math.round(v * 1000) / 1000;
  }
  return null;
}

let cachedPort: SerialPortLike | null = null;

export async function readScaleKg(baudRate = 9600, listenMs = 1200): Promise<number> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  if (!cachedPort) {
    cachedPort = await serial.requestPort();
    await cachedPort.open({ baudRate });
  }
  const port = cachedPort;
  if (!port.readable) throw new Error("Scale port is not readable");
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const stop = setTimeout(() => reader.cancel().catch(() => {}), listenMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(stop);
    reader.releaseLock();
  }
  const kg = parseWeightKg(buf);
  if (kg == null) throw new Error("No weight received — check the scale's baud rate and that an item is on it");
  return kg;
}
