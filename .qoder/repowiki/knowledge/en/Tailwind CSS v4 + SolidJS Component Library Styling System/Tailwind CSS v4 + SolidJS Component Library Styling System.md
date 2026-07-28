---
kind: frontend_style
name: Tailwind CSS v4 + SolidJS Component Library Styling System
category: frontend_style
scope:
    - '**'
source_files:
    - packages/app/src/index.css
    - packages/app/package.json
    - packages/app/src/components/settings-v2/settings-v2.css
    - packages/app/src/components/titlebar.css
---

The OpenCode Web UI uses a layered styling architecture built on Tailwind CSS v4 with a custom component library (`@opencode-ai/ui`) and a session-specific UI package (`@opencode-ai/session-ui`), all integrated into a SolidJS/Vite application.

**Core Styling Stack:**
- **Tailwind CSS v4.1.11** with `@tailwindcss/vite` plugin for build-time processing
- **tw-animate-css** for animation utilities
- **SolidJS** components styled via CSS modules (`.css` files co-located with `.tsx` components)
- Custom design tokens exposed as CSS variables with the `--v2-*` naming convention (e.g., `--v2-background-bg-base`, `--v2-text-text-accent`, `--v2-border-border-base`)

**Architecture & Layering:**
The root entry point `packages/app/src/index.css` serves as the single stylesheet aggregation layer, importing:
1. `@opencode-ai/ui/styles/tailwind` — base Tailwind configuration from the shared UI library
2. `@opencode-ai/session-ui/styles` — session-specific styles
3. `@opencode-ai/ui/v2/styles/tailwind.css` — v2 component system styles
4. `tw-animate-css` — animation utility classes

Component-scoped styles follow a one-file-per-component pattern where each `.tsx` imports its corresponding `.css` file (e.g., `dialog-command-palette-v2.tsx` imports `dialog-command-palette-v2.css`). Shared component styles are imported via `@import` statements within component CSS files.

**Design Token System:**
The codebase uses CSS custom properties extensively through the `--v2-*` namespace covering backgrounds (`--v2-background-*`), text colors (`--v2-text-*`), borders (`--v2-border-*`), icons (`--v2-icon-*`), elevation (`--v2-elevation-*`), and state colors (`--v2-state-*`). These tokens are defined in the shared `@opencode-ai/ui` package and consumed throughout the app.

**Responsive & Accessibility Strategy:**
- Mobile-first responsive breakpoints using standard CSS media queries
- Safe area insets for iOS devices (`env(safe-area-inset-*)`)
- Comprehensive accessibility support including `prefers-reduced-motion`, `prefers-contrast: more`, and `forced-colors` (Windows High Contrast Mode) media queries
- Container queries for component-level responsiveness (`@container getting-started`)
- Scroll-driven animations using CSS scroll-timeline API with fallbacks

**Component Architecture:**
- Uses `data-component` and `data-slot` attributes for component/scoping targeting instead of BEM or class-based selectors
- Two parallel component systems: legacy components and v2 components (`text-input-v2`, `button-v2`, etc.)
- The v2 system provides consistent styling across the application with a unified design language

**Build Integration:**
- Vite handles CSS processing with Tailwind v4's new engine
- CSS is bundled per-component rather than globally, enabling tree-shaking
- The `@opencode-ai/ui` package exports both component logic and their associated CSS styles via separate import paths (`@opencode-ai/ui/v2/button-v2.css`)