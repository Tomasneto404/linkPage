# Interface consistency review

This pass follows [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It applies polish mode to LinkPage's existing design.

## Direction

- Product: a shared library of links and documents for teams.
- Character: calm, precise, familiar.
- World: the existing Apple-inspired interface and system typography.
- Moments: the existing seasonal scenes, selected backgrounds and resource icons.
- Signature: aligned resource actions, consistent search and readable forms.

The user's instructions take precedence over the guide's generic redesign rules. Colours, theme tokens, logos, seasonal assets, optional gradients, 3D scenes, particles and the three motion profiles are retained. This is not a new visual identity.

## Audit and changes

1. **Spacing:** align form labels and fields; reduce unnecessary padding in Appearance; keep its time inputs together; bound the admin document form and give its actions a sticky footer. Keep Workspace's fixed dimensions.
2. **Colour:** retain existing colours. Make installation controls use the configured theme's primary colour and text tokens instead of unrelated fallback variables.
3. **Icons:** replace text glyphs in menus and search with shared inline line icons. Weather conditions use the same icon treatment. Uploaded link icons and the product logo are untouched.
4. **Copy:** give Workspace sections direct names and label installation as “Install LinkPage”. Shorten the local search placeholder while keeping an accessible description of its filtering behaviour.
5. **Typography:** repair invalid font shorthands that caused controls to use browser defaults. Keep system fonts; improve small headings and metadata rather than introducing a new typeface.
6. **Layout:** hide screen-reader-only labels visually, so search gets its full input width. Keep mobile setting switches beside their descriptions, and give standalone selectors the available row width. Remove the desktop flex basis that left a large empty area in stacked account rows; arrange mobile invite fields and account actions without compressed labels.
7. **Details:** name dialogs and close buttons for assistive technology, standardise close and tab hit areas, and style the admin filename input like the public editor.
8. **Visuals:** preserve all backgrounds, seasonal illustrations, brand assets and user-provided images. No new images are generated.
9. **Motion:** retain the user's motion profiles. Limit base control transitions to the properties they actually change, so resizing forms does not animate their layout.

## Verification

Before/after browser captures cover public and admin pages, light/dark mode, sign-in, group navigation, search, QR sharing, Appearance, Settings, Workspace tabs, both document composers and the Markdown reader at desktop and phone widths. Captures use a temporary instance with representative resources; the development instance's data and appearance preferences are not changed by the audit.

Regression coverage checks accessible search labels, narrow-screen document editing and saving, Appearance field layout, touch-sized controls, and the existing themes and motion options.

## Administration follow-up

The Settings audit found repeated boxed rows, uneven field widths, hidden context headings and a horizontal category list that concealed most choices on phones. Workspace had inconsistent control sizes, a large initial empty area, crowded widget layout fields and horizontally scrolling section tabs.

The direction remains calm, precise and familiar: the same LinkPage colours, system type, uploaded resources, seasonal scenes and motion profiles. Settings now uses quiet row separators, aligned fields, shared line icons and a heading for each category. A single category picker replaces the sidebar on phones. Workspace keeps its dimensions across sections, uses the same control rhythm, opens its first available resource and groups widget size options in a disclosure. Phone navigation shows all six sections.

Desktop, phone and dark-mode captures cover all Settings categories and Workspace sections. Final captures report no script errors or page overflow. Widget interactions have browser coverage for mouse resizing, whole-card dragging, persistent dimensions, administrator permissions, link swaps and the shared Subtle, Smooth and Spring profiles. Provider fixtures keep those checks independent of external services.
