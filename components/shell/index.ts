/**
 * Mockup application shell.
 *
 * Layout anatomy (see `docs/ui/design-system.md`):
 *
 *   AppShell
 *   ├─ skip link
 *   ├─ <aside>  → SideNav         (persistent rail, md+)
 *   └─ column
 *      ├─ TopBar                  (sticky header; owns MobileNav drawer)
 *      └─ <main id="mockup-main">  → page content (PageHeader + sections)
 */
export { AppShell } from "./app-shell"
export { SideNav } from "./side-nav"
export { MobileNav } from "./mobile-nav"
export { TopBar } from "./top-bar"
export { ThemeToggle, THEME_STORAGE_KEY, themeInitScript } from "./theme-toggle"
export { PageHeader, Breadcrumbs, type Breadcrumb } from "./page-header"
export {
  BRAND,
  MOCKUP_ROLES,
  NAV_SECTIONS,
  ROLE_META,
  allNavItems,
  findNavItem,
  isActiveHref,
  roleFromPathname,
  type MockupRole,
  type NavItem,
  type NavSection,
} from "./nav-config"
