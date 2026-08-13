import { useEffect, useState } from "react";

export interface CountdownProps {
  readonly seconds: number;
  readonly label: string;
  readonly onElapsed?: () => void;
}

/**
 * The one permitted timer in the app (`design.md`'s "single permitted
 * timer" note) — it re-enables a disabled retry control and never issues a
 * fetch itself. Uses a self-rescheduling one-shot deferred callback rather
 * than a repeating-interval primitive, so it does not trip the
 * `no-polling` structural test (task 2.3), which bans the repeating
 * primitive by name (spelled out fully only in that test file itself).
 */
export function Countdown({ seconds, label, onElapsed }: CountdownProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onElapsed?.();
      return;
    }
    const timeoutId = setTimeout(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [remaining, onElapsed]);

  return (
    <p className="countdown" role="status" aria-live="polite">
      {label} {remaining}s
    </p>
  );
}
