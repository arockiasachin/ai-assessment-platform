/**
 * The tone palette, written down once.
 *
 * Every pair below was measured against the tint it is actually painted on, in
 * both themes (see `docs/ui/design-system.md` §5 for the audit table). The same
 * map backs `StatusPill`, the `StatCard` delta and `Callout`, so a contrast fix
 * lands in one place instead of in every page that hand-rolled a tinted panel.
 *
 * Two rules keep the numbers true:
 *
 * 1. **`-foreground` tokens are for solid fills only.** `--success-foreground`
 *    is white in light mode (1.14:1 on `bg-success/15`) and near-black in dark
 *    mode (1.37:1 on the same tint), and `--warning-foreground` is near-black in
 *    both (1.35:1 in dark). `text-*-foreground` on a `/10`–`/20` tint therefore
 *    fails badly in at least one theme — that is the shape of the dark-mode
 *    regression this file exists to prevent.
 * 2. **The raw `--success` and `--warning` tokens are fills, not text.** At
 *    `oklch(0.62 0.15 155)` success reaches only 2.76:1 as small text, and warning is
 *    worse at 2.54:1 on a card. Success copy therefore uses a darker shade of the same
 *    hue (`SUCCESS_TEXT`) and warning uses its `-foreground` colour (`WARNING_TEXT`),
 *    each with a `dark:` counterpart, because the lighter token is the readable one
 *    there.
 *
 * The only colour literal here is that success shade. The oklch tokens in
 * `app/globals.css` are unchanged.
 */
export type Tone = "info" | "success" | "warning" | "destructive"

/** Success copy: darker shade of the `--success` hue in light, the token in dark. */
export const SUCCESS_TEXT = "text-[oklch(0.45_0.12_155)] dark:text-success"

/**
 * Warning copy, the same pair `TONE_PANEL.warning` uses.
 *
 * It exists because success and warning both fail as text when used raw, and only success had a
 * constant — so warning call sites either inlined the pair or used the token and failed. Warning is
 * worse than success (`--warning` reaches 2.54:1 as small text on a card), and the `-foreground`
 * token that fixes it is a *solid-fill* colour, so it needs the explicit `dark:` counterpart this
 * pair carries rather than standing on its own.
 */
export const WARNING_TEXT = "text-warning-foreground dark:text-warning"

/**
 * A tinted, bordered panel in a tone. Sets the text colour for everything
 * inside (title, body, icon — icons inherit `currentColor`), which is what makes
 * the pair auditable: there is exactly one foreground per tint.
 *
 * Measured (AA needs 4.5:1 for small text): info 5.09 light / 5.01 dark;
 * success 5.86 / 5.01; warning 14.11 / 5.87; destructive 5.00 / 4.88.
 */
export const TONE_PANEL: Record<Tone, string> = {
  info: "border-primary/40 bg-primary/10 text-primary dark:bg-primary/12",
  success: `border-success/40 bg-success/15 ${SUCCESS_TEXT} dark:bg-success/20`,
  warning:
    "border-warning/40 bg-warning/15 text-warning-foreground dark:bg-warning/20 dark:text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/12",
}
