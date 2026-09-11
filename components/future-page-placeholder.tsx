import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function FuturePagePlaceholder({
  role,
  pageName,
}: {
  role: "student" | "teacher"
  pageName: string
}) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
      <CardHeader>
        <Badge
          variant="outline"
          className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary"
        >
          <Sparkles className="size-3.5" />
          Workspace scaffold
        </Badge>
        <CardTitle className="text-base tracking-tight">
          {pageName} is ready for future implementation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          This is a scaffold page connected from the collapsible right menu. You can add the full
          feature implementation here later.
        </p>
        <Link
          href={role === "teacher" ? "/teacher" : "/student"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </CardContent>
    </Card>
  )
}
