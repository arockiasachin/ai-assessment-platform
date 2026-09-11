import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"

type AuthPageShellProps = {
  title: string
  description: string
  footer: ReactNode
  children: ReactNode
}

export function AuthPageShell({ title, description, footer, children }: AuthPageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-10 sm:px-6">
        <Card className="w-full max-w-md border border-border bg-card/90 shadow-xl shadow-black/5">
          <CardHeader className="space-y-2 px-6 pt-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
              <span className="text-lg font-semibold">G</span>
            </div>
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 px-6 pb-6 pt-2">{children}</CardContent>

          <CardFooter className="flex flex-col gap-3 px-6 pb-6 pt-0">{footer}</CardFooter>
        </Card>
      </main>
    </div>
  )
}
