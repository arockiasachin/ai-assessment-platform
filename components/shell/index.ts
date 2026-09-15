/**
 * Application shell — shared by the static `/mockup` tree and the real
 * authenticated `app/(dashboard)` tree.
 *
 * Layout anatomy (see `docs/ui/design-system.md`):
 *
 *   AppShell
 *   ├─ skip link
 *   ├─ <aside>  → SideNav         (persistent rail, md+)
 *   └─ column
 *      ├─ TopBar                  (sticky header; owns MobileNav drawer)
 *      └─ <main id="…-main">      → page content (PageHeader + sections)
 *
 * `AppShell` takes a `scope`:
 *   - `"mockup"` (the default) links to the static mockup routes and keeps the
 *     mockup-only chrome. Every mockup page relies on this default.
 *   - `"app"` links to the real authenticated routes, drops the mockup-only
 *     affordances, and takes the signed-in user from the server.
 */
export { AppShell } from "./app-shell"
export { SideNav } from "./side-nav"
export { MobileNav } from "./mobile-nav"
export { TopBar, type TopBarUser } from "./top-bar"
export { ThemeToggle, THEME_STORAGE_KEY, themeInitScript } from "./theme-toggle"
export { PageHeader, Breadcrumbs, type Breadcrumb } from "./page-header"
export {
  BRAND,
  MOCKUP_ROLES,
  NAV_SECTIONS,
  ROLE_META,
  allNavItems,
  brandHref,
  findNavItem,
  isActiveHref,
  navHref,
  navSectionsFor,
  roleFromPathname,
  roleHome,
  type MockupRole,
  type NavItem,
  type NavScope,
  type NavSection,
} from "./nav-config"
