# Senior Software Engineer Audit Checklist

## Code Quality Checks
- [ ] No unused variables, imports, functions
- [ ] No hardcoded secrets or API keys in code
- [ ] Proper error handling (no silent catches)
- [ ] No console.log left in production code
- [ ] Async/await used correctly (no floating promises)
- [ ] No N+1 database queries
- [ ] Proper TypeScript types (no `any` abuse)
- [ ] Environment variables properly validated on startup

## API Design Checks
- [ ] All endpoints return consistent response shape
- [ ] HTTP status codes used correctly (200/201/400/401/403/404/500)
- [ ] Error messages are specific, not generic
- [ ] Pagination implemented on list endpoints
- [ ] No sensitive data in error responses

## Database Checks
- [ ] Indexes on frequently queried columns
- [ ] No raw SQL with user input (SQL injection risk)
- [ ] Transactions used for multi-step operations
- [ ] Soft deletes where appropriate
- [ ] Foreign key constraints in place

## Backend Architecture
- [ ] Routes → Controllers → Services pattern maintained
- [ ] Authentication middleware on all protected routes
- [ ] Authorization (role-based) on admin routes
- [ ] Input validation on all POST/PATCH endpoints
- [ ] Rate limiting on auth endpoints

## Frontend Architecture
- [ ] State management consistent (Redux/Context)
- [ ] API calls centralized (not scattered in components)
- [ ] Loading/error/empty states for every data fetch
- [ ] No direct DOM manipulation (use React state)
- [ ] No memory leaks (cleanup in useEffect)
