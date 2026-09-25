// First-run state, kept only in this browser (no account needed). Separate from the "vigil-preferences" store so a
// reset of preferences does not replay the introduction, and "Show introduction again" does not touch preferences.

export const ONBOARDING_KEY = "vigil.onboarding";
export const ONBOARDING_EVENT = "vigil:onboarding-changed";

export interface OnboardingState {
  /** The four-step introduction was finished or skipped. */
  introDone: boolean;
  /** The impact-country question was answered or skipped (asked once). */
  countryAsked: boolean;
}

const EMPTY: OnboardingState = { introDone: false, countryAsked: false };

export function readOnboarding(): OnboardingState {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<OnboardingState>) } : EMPTY;
  } catch {
    // Blocked storage: treat as done rather than showing the dialog on every page.
    return { introDone: true, countryAsked: true };
  }
}

export function writeOnboarding(patch: Partial<OnboardingState>) {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ ...readOnboarding(), ...patch }));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(ONBOARDING_EVENT));
}

/** Settings → Help → Show introduction again. */
export function replayIntroduction() {
  writeOnboarding({ introDone: false });
}
