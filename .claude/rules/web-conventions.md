# Web Conventions

## General
- Semantic HTML over `<div>` soup
- CSS: prefer design tokens / CSS variables over hardcoded values
- Responsive-first: mobile breakpoint as default, scale up

## Accessibility
- All interactive elements must be keyboard-accessible
- All images must have `alt` attributes
- Color contrast: WCAG AA minimum (4.5:1 for text)

## Testing
- Unit tests for business logic and utilities
- Component tests for interactive UI (if framework supports)
- Lighthouse CI for performance and accessibility audits (optional)
