# UX/UI Design Audit Checklist

## Visual Consistency
- [ ] Color palette consistent (primary, secondary, danger, success)
- [ ] Typography consistent (font sizes, weights, line heights)
- [ ] Spacing consistent (use design tokens, not random px values)
- [ ] Border radius consistent across all cards/buttons
- [ ] Icon set consistent (all from same library)
- [ ] Shadow/elevation consistent

## Responsive Design
- [ ] No horizontal scroll on any page at 1280px viewport
- [ ] Works on 375px (mobile)
- [ ] Works on 768px (tablet)
- [ ] Works on 1440px (large desktop)
- [ ] Tables switch to card view on mobile

## States — Every Interactive Element Needs All 5:
- [ ] Default state
- [ ] Hover state
- [ ] Active/pressed state
- [ ] Disabled state
- [ ] Loading state (for buttons that make API calls)

## Data States — Every List/Table Needs All 3:
- [ ] Loading skeleton
- [ ] Empty state (with icon + message + CTA)
- [ ] Error state (with retry option)

## Forms
- [ ] Labels above inputs (not just placeholders)
- [ ] Required fields marked with *
- [ ] Inline validation (not just on submit)
- [ ] Error messages below field (not as toasts)
- [ ] Success feedback after submission

## Accessibility
- [ ] Color contrast ratio >= 4.5:1 for normal text
- [ ] Focus indicators visible on all interactive elements
- [ ] Alt text on all images
- [ ] Form inputs have associated labels
- [ ] Error messages linked to their fields

## HRMS-Specific UX
- [ ] Clock-in button large and prominent on mobile
- [ ] Leave balance clearly visible before applying
- [ ] Approval actions (Approve/Reject) are distinct colors
- [ ] Shift times shown in 12-hour format
- [ ] Employee code always shown alongside name
