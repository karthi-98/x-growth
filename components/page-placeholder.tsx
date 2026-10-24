import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** Temporary body for pages a workstream hasn't built yet (docs/WORKSTREAMS.md). */
export function PagePlaceholder({ title, description, owner }: { title: string; description: string; owner: string }) {
  return (
    <div className="t-page-in mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>Being built by the {owner} workstream.</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  )
}
