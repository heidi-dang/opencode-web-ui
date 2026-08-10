# Palette's Journal 🎨

Critical learnings and patterns discovered about this codebase's UX and accessibility:

## Codebase Patterns & Architecture

### 1. Custom Interactive Cards & Divs (`AttachmentCardV2`)
- **Pattern:** The codebase frequently uses custom card layouts using `<div>` elements with `onClick` handlers (e.g., in the composer and timeline for comment and file attachments).
- **Issue:** These were lacking standard keyboard access (`tabIndex`, keyboard activation) and screen reader roles.
- **Solution:** Always wrap clickable custom divs with `role="button"` and `tabIndex={0}`, handle both `Enter` and `Space` keys in `onKeyDown` with `preventDefault()`, and add a dedicated CSS class/selector for `&:focus-visible` with a custom `box-shadow` or `outline` ring:
  ```css
  &[data-clickable]:focus-visible {
    outline: none;
    box-shadow:
      inset 0 0 0 0.5px var(--v2-border-border-base),
      0 0 0 2px var(--v2-border-border-focus);
  }
  ```

### 2. Carousel & Tab Pagination Controls (`DialogReleaseNotes`)
- **Pattern:** Indicators/page dots representing carousel or slide states.
- **Issue:** Dot indicator buttons lacked `aria-label` or selected states (`aria-selected`), making them inaccessible to screen readers.
- **Solution:** Add `role="tablist"` to the container, and `role="tab"`, `aria-selected={isActive}`, and a clear descriptive `aria-label` to each dot button (e.g., `aria-label={highlight.title || "Highlight 1"}`). Also ensure dot indicators are keyboard focusable and display a focus-visible outline or ring.

### 3. Custom Drag-and-Drop Triggers (`DialogEditProject` Icons)
- **Pattern:** Image placeholders or icons inside forms that double as file dropzones or file dialog click triggers.
- **Issue:** These elements are coded as `<div>`s, which prevents keyboard navigation from focusing or triggering them.
- **Solution:** Apply `role="button"`, `tabIndex={0}`, an explicit `aria-label`, and support activating them via Space/Enter with `onKeyDown`.

### 4. Interactive Previews & Iframes (`PreviewPanel`)
- **Pattern:** Embedded live page previews or sandboxed pages.
- **Issue:** Missing standard frame elements (`title`), inputs lacking labels, and interactive tools lacking helper/description attributes.
- **Solution:** Ensure every `<iframe>` element has a clear and descriptive `title` attribute. Add descriptive `aria-label`s to custom nav input boxes and preview utility buttons.

### 5. Menu & Dropdown Triggers (`PromptWorkspaceSelector`, `PromptProjectSelector`)
- **Pattern:** Triggers for nested dropdown lists and settings.
- **Issue:** Text inside triggers may only indicate the active value (e.g., "main" or the project's folder name) without explaining the action.
- **Solution:** Provide explicit dynamic context in `aria-label`s (e.g., `aria-label="Run session in: Workspace Name"` or `aria-label="Search projects: Project Name"`).

### 6. Standard Avatars (`Avatar`, `ProjectAvatar`)
- **Pattern:** Displaying user or project images.
- **Issue:** Fallback to name or initials on failure, but when image is successfully loaded, the `<img>` tag is missing `alt` attributes or has empty alt texts.
- **Solution:** Dynamically feed the fallback initials/text into the `alt` attribute of the image (e.g., `alt={split.fallback}`).

### 7. ResizeObserver Loop Protection (`comment-card-v2.tsx`)
- **Pattern:** `new ResizeObserver(callback)` used to detect truncation by measuring `scrollWidth` vs `clientWidth`.
- **Issue:** When the `ResizeObserver` callback directly calls `setTruncated(...)` (a SolidJS signal setter), it can trigger re-renders that in turn trigger more resize observations, causing "ResizeObserver loop limit exceeded" browser errors.
- **Solution:** Wrap the `ResizeObserver` callback with `requestAnimationFrame` (via `new ResizeObserver(measure)` instead of `new ResizeObserver(sync)`). This defers the state update to the next animation frame, breaking the synchronous resize-→-render-→-resize loop.

### 8. Empty Search Result Guidance (`dialog-command-palette-v2.tsx`)
- **Pattern:** Command palette shows "No results found" as a plain text fallback when the search query yields zero matches.
- **Issue:** Users are left without any guidance on what to do next — there's no CTA to clear the search or a helpful suggestion.
- **Solution:**
  1. Added `ref={inputRef}` to `TextInputV2` so we can focus it programmatically.
  2. Added `showClearButton` and `onClearClick` props to `TextInputV2` in the search bar for quick one-click clearing.
  3. Enhanced the fallback `command-palette-v2-state` block: shows the "No results found" heading, plus a helpful hint ("Try checking your spelling or using more general terms.") and a "Clear search" button — but only when the query is non-empty and results are not loading.

### 9. Active Search Term Highlighting (`dialog-command-palette-v2.tsx` + `dialog-command-palette-v2.css`)
- **Pattern:** Command palette matches and ranks entries by the user's query, but renders all titles/descriptions/paths as plain text.
- **Issue:** Users cannot easily spot _why_ a result is shown — the matching substring is invisible.
- **Solution:**
  1. Added a reactive `HighlightText` SolidJS component that splits text on the query string using a case-insensitive regex and wraps each matched part in a `<mark>` element.
  2. Passed the current `query()` down into `PaletteRow` as a new `query?: string` prop.
  3. Replaced bare text in command titles, descriptions, file directories, and file names with `<HighlightText>` calls.
  4. Added `.command-palette-v2 mark` CSS rule using CSS custom properties (`--v2-background-bg-layer-04`, `--v2-text-text-strong`) for a subtle, on-brand highlight look with a slight background tint and bold weight.
