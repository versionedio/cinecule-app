import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <span
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-border",
        className
      )}
    >
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => setTheme("light")}
        className={cn(
          "px-4 py-1.5 font-display text-[11px] uppercase tracking-widest transition-colors",
          theme === "light" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"
        )}
      >
        Paper
      </button>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => setTheme("dark")}
        className={cn(
          "px-4 py-1.5 font-display text-[11px] uppercase tracking-widest transition-colors",
          theme === "dark" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"
        )}
      >
        Ink
      </button>
    </span>
  );
}
