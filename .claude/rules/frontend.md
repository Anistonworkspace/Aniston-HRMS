---
scope: frontend/src/**
description: Frontend coding rules for Aniston HRMS
---

# Frontend Rules

## API Calls
- Always use RTK Query hooks — never raw `fetch()` or `axios`
- Every query must have `providesTags` for cache invalidation
- Every mutation must have `invalidatesTags`
- Base API configured in `frontend/src/app/api.ts` with 401 auto-refresh

## State Management
- Redux store ONLY for auth state (user + accessToken)
- All server data via RTK Query (auto-cached)
- Never store sensitive data (salary, Aadhaar, PAN) in Redux

## Components
- Function components with hooks only
- Forms: React Hook Form + Zod resolver
- Currency: `formatCurrency()` from `lib/utils.ts` (INR, en-IN locale)
- Dates: `formatDate()` from `lib/utils.ts`
- Loading: use Loader2 spinner or skeleton animations
- Errors: wrap in ErrorBoundary component

## Styling
- Tailwind CSS only — no inline styles or CSS modules
- Use existing utility classes: `.layer-card`, `.btn-primary`, `.input-glass`, `.badge`
- Fonts: Sora (headings), DM Sans (body), JetBrains Mono (data/numbers with `data-mono`)
- Brand color: indigo-600 (#4f46e5)
- Glassmorphism: layered shadows, backdrop-blur

## Role-Based UI
- Check `user.role` before showing admin-only components
- Salary/payroll hidden from EMPLOYEE and INTERN roles
- Settings page: SUPER_ADMIN and ADMIN only
