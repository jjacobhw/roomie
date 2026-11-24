import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// True when the person has turned on "Reduce Motion" (iOS) or "Remove animations" (Android),
// so the app can skip its animations for them.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
