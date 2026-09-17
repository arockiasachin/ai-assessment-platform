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
 * 2. **`--success` and `--warning` are fills, not text.** Measured on this theme's card,
 *    success reaches 3.40:1 and warning 2.54:1 — both below AA's 4.5:1. Copy therefore uses
 *    `--success-text` / `--warning-text`, which carry the same hue and chroma at a lower
 *    lightness (5.43:1 and 5.62:1 on card, and still 4.74:1 / 4.92:1 on the `/12`–`/15` tint
 *    they sit inside). On the dark theme those tokens alias the fills, which are legible
 *    there (7.05:1 and 8.70:1). The measurements live beside the declarations in
 *    `app/globals.css`.
 *
 * The only colour literal here is that success shade. The oklch tokens in
 * `app/globals.css` are unchanged.
 */
export type Tone = "info" | "success" | "warning" | "destructive"

/**
 * Success copy.
 *
 * This used to be an arbitrary literal — `text-[oklch(0.45_0.12_155)] dark:text-success` — because the
 * theme had no text-safe success token. It now points at one (`--success-text`), so the value lives in
 * `app/globals.css` with the contrast measurement beside it instead of being hardcoded in a Tailwind
 * class that the audit could not see.
 */
export const SUCCESS_TEXT = "text-success-text"

/**
 * Warning copy, the same role as `SUCCESS_TEXT`.
 *
 * Warning was the worse of the two as raw text (2.54:1 on a card), and the `-foreground` token that
 * used to patch it is a *solid-fill* colour, which is why the patch needed an explicit `dark:`
 * counterpart. `--warning-text` carries both themes itself.
 */
export const WARNING_TEXT = "text-warning-text"

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
