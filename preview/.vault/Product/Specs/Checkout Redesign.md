---
tags: [spec, checkout, p0]
status: in-review
owner: Mei
updated: 2026-10-12
---
# Checkout Redesign

> One-page checkout with inline validation, Apple Pay first, and a persistent order summary.

## Goals
- Cut checkout abandonment from **31%** to under 20%
- Ship [[Payment Methods]] as the first step, not the last
- Reuse the [[Button]] and [[Input Field]] components — no one-off styles

## User flow
1. Cart review (collapsed summary, editable quantities)
2. Shipping — address autocomplete, saved addresses
3. Payment — Apple Pay / Google Pay above the fold, cards below
4. Confirmation — order number, ETA, "track order" CTA

## Open questions
- [ ] Do we support split tenders? (ask #finance)
- [x] Guest checkout stays — confirmed with Ravi
- [ ] Error copy for declined cards: see [[Error States]]

## Acceptance criteria
| Criteria | Measure |
| --- | --- |
| Time to complete | < 90s median |
| Validation | Inline, on blur, never on keystroke |
| Accessibility | WCAG 2.2 AA, keyboard-complete |

See research in [[Checkout Interviews Oct]].
