// The test-only text switches (spec 06 §3.6; spec 03 AC-ENG-11). They exist only to compare
// against the C++ build. Product code never builds them: the values come from `lekhjs/testing`
// (`setTestConfig`) or the gated `__lekhTest.setConfig`, and `BoardSession` refuses a config with
// a switch on unless it came from there (session work). Default: everything off.

export interface TextTestSwitches {
  /** Layout and paint use the C++ web pitch: 1.00 × font size (no multiplier), `textBaseline = 'top'` at `top + i·LP` (neutralises DR-TXT-01, -02). */
  readonly lineSpacingCompat: boolean;
  /** An unknown or platform-only family falls back to `sans-serif` instead of Noto Sans (neutralises DR-TXT-07). */
  readonly fontFallbackCompat: boolean;
  /** Replaces `LINE_PITCH` (AC-ENG-11); `undefined` keeps 1.18. */
  readonly linePitch: number | undefined;
}

export const TEXT_SWITCHES_OFF: TextTestSwitches = Object.freeze({
  lineSpacingCompat: false,
  fontFallbackCompat: false,
  linePitch: undefined,
});
