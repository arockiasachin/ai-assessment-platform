import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  MOCKUP_ROLES,
  NAV_SECTIONS,
  PREVIEW_ROLES,
  ROLE_META,
  allNavItems,
  brandHref,
  findNavItem,
  findNavItemByAppPath,
  isActiveHref,
  navHref,
  navSectionsFor,
  roleFromPathname,
  roleHome,
} from "@/components/shell/nav-config"

/**
 * Nav scope contract.
 *
 * The shell serves two trees from one nav definition: the static `/mockup` tree
 * and the real authenticated `app/(dashboard)` tree. The risk this file exists to
 * prevent is a nav link that points at a page that does not exist — which is
 * exactly what a naive "strip the /mockup prefix" translation would produce,
 * because some mockup routes were renamed in the real tree and others (profile,
 * settings, submissions) were never built at all.
 *
 * These tests walk the filesystem, so adding a nav item pointing at a missing
 * page fails here rather than in front of a user.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const appDir = path.join(repoRoot, "app")
const dashboardDir = path.join(appDir, "(dashboard)")
const mockupDir = path.join(appDir, "mockup")

function hasPage(root: string, route: string): boolean {
  const rel = route.replace(/^\//, "")
  return fs.existsSync(path.join(root, rel, "page.tsx"))
}

/** `/mockup/teacher/reviews` → `teacher/reviews` */
function mockupRel(href: string): string {
  return href.replace(/^\/mockup/, "").replace(/^\//, "")
}

const ITEMS = allNavItems()

describe("nav scope: mockup tree is unchanged", () => {
  it("resolves every item to its own mockup href", () => {
    for (const { item } of ITEMS) {
      expect(navHref(item.href, "mockup"), item.href).toBe(item.href)
    }
  })

  it("returns the section list a mockup page would link", () => {
    for (const role of MOCKUP_ROLES) {
      const total = navSectionsFor(role, "mockup").reduce((n, s) => n + s.items.length, 0)
      const expected = allNavItems().filter((entry) => entry.role === role).length
      expect(total, role).toBe(expected)
    }
  })

  it("every mockup nav href has a mockup page on disk", () => {
    for (const { item } of ITEMS) {
      const rel = mockupRel(item.href)
      const exists =
        rel === "" ? fs.existsSync(path.join(mockupDir, "page.tsx")) : hasPage(mockupDir, rel)
      expect(exists, `${item.href} has no page under app/mockup`).toBe(true)
    }
  })

  it("treats a role home as active only on itself", () => {
    expect(isActiveHref("/mockup/teacher", "/mockup/teacher", "mockup")).toBe(true)
    expect(isActiveHref("/mockup/teacher/classes", "/mockup/teacher", "mockup")).toBe(false)
    expect(isActiveHref("/mockup/teacher/classes", "/mockup/teacher/classes", "mockup")).toBe(true)
  })

  it("reads the role from the mockup path", () => {
    expect(roleFromPathname("/mockup/teacher/reviews")).toBe("teacher")
    expect(roleFromPathname("/mockup/student")).toBe("student")
    expect(roleFromPathname("/mockup/admin/data")).toBe("admin")
    expect(roleFromPathname("/mockup")).toBeNull()
  })

  it("keeps the mockup index as the brand target", () => {
    expect(brandHref("mockup")).toBe("/mockup")
  })
})

describe("admin is reachable but unadvertised", () => {
  it("omits admin from the roles the shell advertises", () => {
    // Administrators are provisioned by invitation, and the real app already
    // hides admin (proxy.ts redirects non-admins away from /admin, and the nav
    // is role-scoped). Re-adding admin here would re-advertise it.
    expect(PREVIEW_ROLES).not.toContain("admin")
    expect([...PREVIEW_ROLES].sort()).toEqual(["student", "teacher"])
  })

  it("still knows admin exists, so nav iteration is unaffected", () => {
    expect(MOCKUP_ROLES).toContain("admin")
    // The complete set is what allNavItems walks and what the active-href home
    // set is derived from; shrinking it would break both.
    for (const role of PREVIEW_ROLES) expect(MOCKUP_ROLES).toContain(role)
  })

  it("keeps the admin workspace reachable by URL", () => {
    // Not advertised, but not removed: the hidden link points at this home.
    expect(roleHome("admin", "mockup")).toBe("/mockup/admin")
    expect(findNavItem("/mockup/admin")?.role).toBe("admin")
    expect(navSectionsFor("admin", "mockup").length).toBeGreaterThan(0)
  })

  it("exposes admin's home so the index footer link cannot drift", () => {
    expect(ROLE_META.admin.home).toBe("/mockup/admin")
  })
})

describe("app-only nav items", () => {
  const APP_ONLY = NAV_SECTIONS.teacher.flatMap((s) => s.items).filter((i) => i.appOnly)

  it("exist, and carry a real path rather than a mockup one", () => {
    expect(APP_ONLY.length).toBeGreaterThan(0)
    for (const item of APP_ONLY) {
      expect(item.href.startsWith("/mockup"), `${item.label} should not be a mockup href`).toBe(
        false,
      )
      expect(item.href.startsWith("/"), item.label).toBe(true)
    }
  })

  it("resolve to their real href in both scopes", () => {
    for (const item of APP_ONLY) {
      expect(navHref(item.href, "app"), item.label).toBe(item.href)
      expect(navHref(item.href, "mockup"), item.label).toBe(item.href)
    }
  })

  it("are excluded from the mockup nav, which has no page for them", () => {
    for (const role of MOCKUP_ROLES) {
      const hrefs = navSectionsFor(role, "mockup").flatMap((s) => s.items.map((i) => i.href))
      for (const item of APP_ONLY) {
        expect(hrefs, `${item.label} must not appear in mockup nav`).not.toContain(item.href)
      }
    }
  })

  it("are included in the app nav", () => {
    const hrefs = navSectionsFor("teacher", "app").flatMap((s) => s.items.map((i) => i.href))
    for (const item of APP_ONLY) expect(hrefs, item.label).toContain(item.href)
  })

  it("are excluded from allNavItems, which means the mockup tree", () => {
    // allNavItems feeds the mockup index's page count and the "every mockup nav
    // href has a mockup page" assertion, both of which would be wrong otherwise.
    const hrefs = allNavItems().map((entry) => entry.item.href)
    for (const item of APP_ONLY) expect(hrefs, item.label).not.toContain(item.href)
  })

  it("have a real page on disk, like every other app-scope href", () => {
    for (const item of APP_ONLY) {
      expect(
        hasPage(dashboardDir, item.href),
        `${item.href} has no page under app/(dashboard)`,
      ).toBe(true)
    }
  })

  it("cannot leak into the mockup tree through a raw-constant consumer", () => {
    // The regression this guards: `app/mockup/page.tsx` iterated the raw
    // `NAV_SECTIONS` instead of `navSectionsFor(role, "mockup")`, so the mockup
    // index rendered a card linking to the real `/teacher/offerings` — walking a
    // reviewer out of the mockup tree and into the authenticated app. The tests
    // above could not see it, because they only exercise the helpers while the
    // index read the constant directly.
    //
    // So assert on the SOURCE, not just the helpers: no file under `app/mockup`
    // may reference `NAV_SECTIONS`. Mockup pages must go through
    // `navSectionsFor`, which is what applies the `appOnly` filter.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
          // Strip comments: prose may legitimately name the constant.
          const code = fs
            .readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
          if (/\bNAV_SECTIONS\b/.test(code)) offenders.push(path.relative(repoRoot, full))
        }
      }
    }
    walk(mockupDir)
    expect(offenders, "mockup files must use navSectionsFor, not NAV_SECTIONS").toEqual([])
  })
})

describe("nav scope: app tree resolves to real pages", () => {
  it("every non-null app nav href has a real page on disk", () => {
    for (const { item } of ITEMS) {
      const href = navHref(item.href, "app")
      if (href === null) continue
      expect(
        hasPage(dashboardDir, href),
        `${item.href} → ${href} has no page under app/(dashboard)`,
      ).toBe(true)
    }
  })

  it("maps the two renamed routes to their real destinations", () => {
    expect(navHref("/mockup/teacher/quiz-ai", "app")).toBe("/teacher/quiz-generation")
    expect(navHref("/mockup/teacher/activity", "app")).toBe("/teacher/observability")
  })

  it("derives the rest by stripping the mockup prefix", () => {
    expect(navHref("/mockup/teacher/reviews", "app")).toBe("/teacher/reviews")
    expect(navHref("/mockup/student/peer-evaluation", "app")).toBe("/student/peer-evaluation")
    expect(navHref("/mockup/admin/users", "app")).toBe("/admin/users")
  })

  it("has no app counterpart for the mockup index", () => {
    expect(navHref("/mockup", "app")).toBeNull()
  })

  it("drops items whose page was never built, rather than linking to a 404", () => {
    // These are mockup-only: the design anticipated a destination the backend
    // does not have. (`teacher/submissions` used to be here, and was promoted to
    // a real route — see docs/plans/wave-1.md §D2.)
    for (const href of [
      "/mockup/teacher/profile",
      "/mockup/teacher/settings",
      "/mockup/student/profile",
      "/mockup/student/settings",
      "/mockup/admin/profile",
      "/mockup/admin/settings",
    ]) {
      expect(navHref(href, "app"), href).toBeNull()
    }
  })

  it("filters dropped items out of the app section list", () => {
    for (const role of MOCKUP_ROLES) {
      const sections = navSectionsFor(role, "app")
      const hrefs = sections.flatMap((s) => s.items.map((i) => navHref(i.href, "app")))
      expect(
        hrefs.every((h) => h !== null),
        role,
      ).toBe(true)
      // No empty section should survive the filter.
      expect(
        sections.every((s) => s.items.length > 0),
        role,
      ).toBe(true)
    }
    // teacher loses profile and settings, and gains the app-only Offerings page.
    const teacherApp = navSectionsFor("teacher", "app").reduce((n, s) => n + s.items.length, 0)
    const teacherMockup = navSectionsFor("teacher", "mockup").reduce(
      (n, s) => n + s.items.length,
      0,
    )
    expect(teacherApp).toBe(teacherMockup - 2 + 1)
  })

  it("anchors the brand on the signed-in role's home", () => {
    expect(brandHref("app", "teacher")).toBe("/teacher")
    expect(brandHref("app", "student")).toBe("/student")
    expect(brandHref("app", "admin")).toBe("/admin")
  })

  it("treats a role home as active only on itself, with real paths", () => {
    expect(isActiveHref("/teacher", "/teacher", "app")).toBe(true)
    // The bug this guards: `/teacher` is a prefix of `/teacher/classes`.
    expect(isActiveHref("/teacher/classes", "/teacher", "app")).toBe(false)
    expect(isActiveHref("/teacher/classes", "/teacher/classes", "app")).toBe(true)
  })

  it("reads the role from the first real path segment", () => {
    expect(roleFromPathname("/teacher/reviews", "app")).toBe("teacher")
    expect(roleFromPathname("/student/quizzes", "app")).toBe("student")
    expect(roleFromPathname("/admin/users", "app")).toBe("admin")
    expect(roleFromPathname("/login", "app")).toBeNull()
  })

  it("role homes are the real role roots", () => {
    expect(roleHome("teacher", "app")).toBe("/teacher")
    expect(roleHome("teacher", "mockup")).toBe("/mockup/teacher")
  })
})

describe("findNavItemByAppPath", () => {
  it("resolves a real path that has no override", () => {
    // `/teacher/analytics` is derived by stripping `/mockup`, so the nav item's own href is
    // `/mockup/teacher/analytics` and a plain `findNavItem` would miss it.
    const found = findNavItemByAppPath("/teacher/analytics")
    expect(found?.item.href).toBe("/mockup/teacher/analytics")
    expect(found?.item.description).toBeTruthy()
  })

  it("resolves a real path that IS overridden", () => {
    // Renamed in the real tree: "Activity log" lives at /teacher/observability.
    const found = findNavItemByAppPath("/teacher/observability")
    expect(found?.item.href).toBe("/mockup/teacher/activity")
  })

  it("resolves every app-scope nav destination to an item", () => {
    // If a destination were reachable in the nav but unresolvable here, a page reading its
    // heading description would silently render no description.
    for (const section of navSectionsFor("teacher", "app")) {
      for (const item of section.items) {
        const path = navHref(item.href, "app")
        if (path === null) continue
        expect(findNavItemByAppPath(path), path).not.toBeNull()
      }
    }
  })

  it("returns null for a path with no nav item", () => {
    expect(findNavItemByAppPath("/teacher/not-a-page")).toBeNull()
  })

  it("returns null for a mockup-only surface, which has no real page", () => {
    // `navHref` returns null for these, so they can never match — nothing should render a
    // heading for a page that does not exist.
    expect(findNavItemByAppPath("/mockup/teacher/settings")).toBeNull()
  })
})
