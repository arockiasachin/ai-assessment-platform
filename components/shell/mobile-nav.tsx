"use client"

import { useState } from "react"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ROLE_META, type MockupRole, type NavScope } from "@/components/shell/nav-config"
import { SideNav } from "@/components/shell/side-nav"

/**
 * Mobile navigation: a hamburger trigger that opens the same `SideNav` in a
 * left slide-over drawer.
 *
 * Built on the shared `Dialog` primitive on purpose — it already provides the
 * focus trap, focus restore, Escape-to-close and `aria-modal` semantics we need,
 * so the drawer cannot regress into a hand-rolled non-accessible overlay. The
 * trigger and drawer are `md:hidden`: from `md` up the persistent rail takes
 * over.
 */
export function MobileNav({ role, scope = "mockup" }: { role: MockupRole; scope?: NavScope }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" />}
        aria-label="Open navigation"
      >
        <Menu className="size-5" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        className="top-0 left-0 flex h-full max-h-none w-72 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none rounded-r-2xl p-0 sm:max-w-[85vw] data-open:slide-in-from-left data-closed:slide-out-to-left"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="text-sm font-semibold tracking-tight">
            {ROLE_META[role].label} workspace
          </DialogTitle>
          <DialogDescription className="sr-only">
            {scope === "mockup"
              ? `Mockup navigation for the ${ROLE_META[role].label.toLowerCase()} workspace.`
              : `Navigation for the ${ROLE_META[role].label.toLowerCase()} workspace.`}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <SideNav role={role} scope={scope} onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
