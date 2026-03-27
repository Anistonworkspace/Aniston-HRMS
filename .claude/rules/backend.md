---
scope: backend/src/**
description: Backend coding rules for Aniston HRMS
---

# Backend Rules

## Controllers
- Must be thin — no business logic, only: parse request → call service → send response
- Always use `try/catch` with `next(err)` for error propagation

## Services
- All business logic lives here
- Throw `AppError` (NotFoundError, BadRequestError, etc.) — never generic `Error`
- Always include `organizationId` in queries for multi-tenant data
- Use `prisma.$transaction` for multi-table writes
- Call `auditLogger` on every create/update/delete operation

## Routes
- First middleware: `authenticate` (JWT verification)
- Second: `requirePermission(resource, action)` or `authorize(...roles)`
- Third: `validateRequest(zodSchema)` for POST/PATCH bodies
- Rate limiting applied to all mutation routes

## Security
- Never store plain text passwords — bcrypt with minimum 12 rounds
- AES-256-GCM for Aadhaar, PAN, bank account fields
- Never expose Prisma errors or stack traces in API responses
- Validate file uploads by MIME type AND extension
- Always sanitize user input before database queries
