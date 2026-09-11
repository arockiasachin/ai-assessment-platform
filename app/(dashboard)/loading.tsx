/**
 * Route-group loading boundary.
 *
 * Without a `loading.tsx`, App Router navigation to a dashboard route blocks on
 * the server component's data queries with no fallback, so a slow gradebook or
 * analytics query looks like a dead click. This boundary streams an immediate,
 * announced placeholder while the page resolves.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <p role="status" className="text-sm text-muted-foreground">
        Loading page…
      </p>
    </div>
  )
}
