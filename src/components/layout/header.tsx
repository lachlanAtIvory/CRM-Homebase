"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Rocket } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { signOut } from "@/lib/actions";

const PAGE_TITLES: Record<string, string> = {
  "/":                "Home",
  "/pipeline":        "Pipeline",
  "/clients":         "Clients",
  "/agents":          "Agents",
  "/calendar":        "Calendar",
  "/settings":        "Settings",
  "/application/new": "Launch Application",
};

interface HeaderProps {
  email: string;
  avatarUrl?: string | null;
}

export function Header({ email, avatarUrl }: HeaderProps) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? "Agent Ivory CRM";
  const initials = email[0]?.toUpperCase() ?? "?";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <h1 className="text-base font-semibold">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Launch Application — primary CTA in the top-right */}
        <Link
          href="/application/new"
          className="group inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20 active:scale-[0.96]"
        >
          <Rocket size={13} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:rotate-12" />
          Launch Application
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="User menu"
          >
            <Avatar size="sm">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={email} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="min-w-52">
            <div className="truncate px-1.5 py-1 text-xs text-muted-foreground">
              {email}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => signOut()}
            >
              <LogOut size={14} className="mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
