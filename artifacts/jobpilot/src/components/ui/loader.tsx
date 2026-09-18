import { Loader2 } from "lucide-react"

export function Loader({ className, size = "default" }: { className?: string; size?: "default" | "sm" }) {
  if (size === "sm") {
    return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />
  }

  return (
    <div className={`flex w-full flex-col items-center justify-center py-12 space-y-4 ${className}`}>
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground animate-pulse">Processing...</p>
    </div>
  )
}
