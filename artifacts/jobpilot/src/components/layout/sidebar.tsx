import * as React from "react"
import { Link, useLocation } from "wouter"
import { useClerk } from "@clerk/react"
import { 
  LayoutDashboard, 
  Briefcase, 
  FileText, 
  Zap, 
  User,
  PlaneTakeoff,
  LogOut
} from "lucide-react"
import { cn } from "@/lib/utils"

const nav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Discovery", href: "/jobs", icon: Briefcase },
  { name: "Pipeline", href: "/applications", icon: FileText },
  { name: "Batch Engine", href: "/batch", icon: Zap },
  { name: "Pilot Profile", href: "/profile", icon: User },
]

export function Sidebar() {
  const [location] = useLocation()
  const { signOut } = useClerk()
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

  return (
    <div className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shadow-sm">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-2">
        <PlaneTakeoff className="h-6 w-6 text-accent" />
        <span className="font-serif font-bold text-xl tracking-tight text-white">
          JobPilot<span className="text-accent">.</span>
        </span>
      </div>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">Workspace</div>
        {nav.map((item) => {
          const isActive = location === item.href
          return (
            <Link 
              key={item.name} 
              href={item.href} 
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group",
                isActive 
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" 
                  : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className={cn(
                "w-4 h-4 transition-colors",
                isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground"
              )} />
              {item.name}
            </Link>
          )
        })}
      </div>
      <div className="p-4 border-t border-sidebar-border flex flex-col gap-2">
        <button
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-accent-foreground text-left"
        >
          <LogOut className="w-4 h-4 text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground" />
          Sign Out
        </button>
        <div className="text-xs text-sidebar-foreground/50 flex flex-col gap-1 mt-2 px-2">
          <span>JobPilot Agent UI v0.1</span>
          <span>Systems Online</span>
        </div>
      </div>
    </div>
  )
}
