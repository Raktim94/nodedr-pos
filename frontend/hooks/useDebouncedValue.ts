import { useEffect, useState } from "react";

// The value, but only once it has stopped changing for `delayMs` — so a search
// box can type freely and the API is asked once per pause.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}
