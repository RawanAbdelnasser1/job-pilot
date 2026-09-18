import { Link } from "wouter";
import { PlaneTakeoff, ShieldCheck, ArrowRight, Zap, Target, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="px-8 py-6 flex items-center justify-between border-b border-border bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <PlaneTakeoff className="h-7 w-7 text-accent" />
          <span className="font-serif font-bold text-2xl tracking-tight text-foreground">
            JobPilot<span className="text-accent">.</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" asChild className="font-medium text-muted-foreground hover:text-foreground">
            <Link href="/sign-in">Log in</Link>
          </Button>
          <Button asChild className="bg-primary hover:bg-primary/90 text-white font-medium shadow-sm">
            <Link href="/sign-up">Start Piloting</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center py-20 px-8 text-center max-w-5xl mx-auto w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-medium text-sm mb-8 border border-accent/20">
          <ShieldCheck className="w-4 h-4" />
          Next-generation AI job tracking
        </div>

        <h1 className="text-6xl md:text-7xl font-serif font-bold tracking-tight text-foreground mb-6 max-w-4xl leading-tight">
          Navigate your career with <span className="text-primary relative inline-block">
            precision
            <div className="absolute -bottom-2 left-0 w-full h-1 bg-accent/60 rounded-full"></div>
          </span>
        </h1>
        
        <p className="text-xl text-muted-foreground mb-12 max-w-2xl leading-relaxed">
          JobPilot tracks, tailors, and accelerates your applications using AI. Stop guessing and start landing more interviews.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 mb-20 w-full justify-center">
          <Button size="lg" asChild className="w-full sm:w-auto text-lg h-14 px-8 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95">
            <Link href="/sign-up">
              Launch Your Search
              <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="w-full sm:w-auto text-lg h-14 px-8 border-border bg-white hover:bg-muted text-foreground transition-all">
            <Link href="/sign-in">
              Go to Dashboard
            </Link>
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-8 w-full">
          <div className="bg-white p-8 rounded-2xl border border-border text-left flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-2">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="font-serif font-bold text-xl text-foreground">Discovery</h3>
            <p className="text-muted-foreground leading-relaxed">Keep all your potential opportunities in one consolidated queue, automatically enriched with company data.</p>
          </div>
          
          <div className="bg-white p-8 rounded-2xl border border-border text-left flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center text-accent mb-2">
              <Target className="w-6 h-6" />
            </div>
            <h3 className="font-serif font-bold text-xl text-foreground">Tailoring</h3>
            <p className="text-muted-foreground leading-relaxed">Generate bespoke cover letters and adjust your CV instantly to match exactly what the listing requires.</p>
          </div>
          
          <div className="bg-white p-8 rounded-2xl border border-border text-left flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-sidebar/10 rounded-xl flex items-center justify-center text-sidebar mb-2">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="font-serif font-bold text-xl text-foreground">Batch Engine</h3>
            <p className="text-muted-foreground leading-relaxed">Process applications in bulk with automated follow-ups, interview tracking, and analytics.</p>
          </div>
        </div>
      </main>

      <footer className="py-8 border-t border-border text-center text-muted-foreground text-sm">
        <p>© {new Date().getFullYear()} JobPilot. All systems nominal.</p>
      </footer>
    </div>
  );
}
