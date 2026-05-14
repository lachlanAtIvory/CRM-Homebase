"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Kanban,
  Users,
  ListTodo,
  FileText,
  Bot,
  CalendarDays,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const NAV = [
  { href: "/",             label: "Home",         icon: LayoutDashboard },
  { href: "/pipeline",     label: "Pipeline",     icon: Kanban          },
  { href: "/clients",      label: "Clients",      icon: Users           },
  { href: "/applications", label: "Applications", icon: FileText        },
  { href: "/tasks",        label: "Tasks",        icon: ListTodo        },
  { href: "/agents",       label: "Agents",       icon: Bot             },
  { href: "/calendar",     label: "Calendar",     icon: CalendarDays    },
  { href: "/settings",     label: "Settings",     icon: Settings        },
] as const;

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-14 items-center border-b px-3">
        {!collapsed && (
          <span className="flex-1 truncate text-sm font-semibold text-sidebar-foreground">
            Agent Ivory
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors",
            collapsed && "mx-auto",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                collapsed && "justify-center",
              )}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
