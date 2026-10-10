import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * "Classical" tokens live as CSS variables in src/index.css so both
 * Tailwind classes and one-off inline styles (e.g. SVG fills) can share them.
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        "surface-raised": "hsl(var(--surface-raised) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          dim: "hsl(var(--primary-dim) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          text: "hsl(var(--primary-text) / <alpha-value>)"
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)"
        },
        success: "hsl(var(--success) / <alpha-value>)",
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          text: "hsl(var(--destructive-text) / <alpha-value>)"
        },
        info: "hsl(var(--info) / <alpha-value>)"
      },
      fontFamily: {
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["'Lora'", "Georgia", "serif"],
        mono: ["ui-monospace", "Menlo", "monospace"]
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "scale-in": "scale-in 0.3s cubic-bezier(0.16,1,0.3,1) both"
      },
      boxShadow: {
        sm: "0 1px 2px hsl(var(--foreground) / 0.14)",
        card: "0 3px 10px hsl(var(--foreground) / 0.16)",
        "card-hover": "0 12px 32px hsl(var(--foreground) / 0.22)"
      }
    }
  },
  plugins: [tailwindcssAnimate]
} satisfies Config;
