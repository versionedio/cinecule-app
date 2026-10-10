import { ReactNode, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Clapperboard, LayoutDashboard, LogOut, Menu, Plug, User, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/projects", label: "Projects", icon: Clapperboard },
  { path: "/integrations", label: "Integrations", icon: Plug },
  { path: "/profile", label: "Profile", icon: User }
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <Clapperboard className="h-5 w-5 text-primary" />
        <span className="font-display text-lg font-semibold leading-tight tracking-tight">Cinematic Studio</span>
      </div>
      <div className="hr" />
      <nav className="flex-1 space-y-1 p-2.5">
        {NAV.map((item) => {
          const active = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path);
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[4px] px-3 py-2 text-sm transition-colors",
                active ? "bg-primary/10 text-primary-text" : "text-muted hover:bg-surface-raised hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="hr" />
      <div className="p-2.5">
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-[4px] px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { profile } = useAuth();
  const initials = profile?.fn ? `${profile.fn[0]}${profile.ln?.[0] ?? ""}` : profile?.email?.[0]?.toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-surface md:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-60 border-r border-border bg-surface outline-none md:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarContent onNavigate={() => setOpen(false)} />
            <DialogPrimitive.Close className="absolute right-3 top-5 text-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
          <button
            className="rounded-[4px] p-2 text-muted hover:bg-surface-raised hover:text-foreground md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <ThemeToggle className="hidden sm:inline-flex" />
          <span className="hidden text-sm text-muted sm:inline">
            {profile?.fn ? `${profile.fn} ${profile.ln ?? ""}` : profile?.email}
          </span>
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile?.picurl || profile?.picture} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
