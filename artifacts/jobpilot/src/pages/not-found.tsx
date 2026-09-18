import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plane } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] text-center space-y-6">
      <div className="p-4 rounded-full bg-muted/50 text-muted-foreground">
        <Plane className="w-12 h-12" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Route Not Found</h1>
        <p className="text-muted-foreground max-w-[400px]">
          The coordinates you entered don't match any known sectors. 
          Return to base and recalibrate.
        </p>
      </div>
      <Button asChild size="lg" className="mt-4">
        <Link href="/">Return to Dashboard</Link>
      </Button>
    </div>
  );
}
