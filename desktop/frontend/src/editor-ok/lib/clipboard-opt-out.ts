/**
 * Clipboard opt-out attribute — vendored constant from OpenKnowledge's
 * `editor/clipboard/clipboard-sanitize.ts`. Chrome-rendering extensions set
 * this on their non-content DOM so clipboard walkers (not vendored here)
 * skip it. Kept so the vendored chrome files stay byte-close to upstream.
 */
export const OPT_OUT_ATTR = 'data-clipboard-omit' as const;
