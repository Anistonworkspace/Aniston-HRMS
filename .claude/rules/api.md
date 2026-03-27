---
scope: backend/src/modules/**/**.routes.ts
description: API endpoint rules for Aniston HRMS
---

# API Rules

## Response Envelope
All responses MUST use:
```json
// Success
{ "success": true, "data": {}, "meta": { "page": 1, "limit": 20, "total": 100 } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Employee not found" } }
```

## HTTP Status Codes
- 200: Success (GET, PATCH)
- 201: Created (POST)
- 400: Validation error (bad request body)
- 401: Not authenticated (missing/invalid JWT)
- 403: Not authorized (RBAC denied)
- 404: Resource not found
- 409: Conflict (duplicate record)
- 429: Rate limited
- 500: Server error (never expose details)

## Rate Limits
- Auth routes: 50 requests per 15 minutes
- Walk-in register: 5 per minute
- Recruitment apply: 10 per minute
- General: 100 per minute

## Pagination
All list endpoints accept `?page=1&limit=20` and return:
```json
"meta": { "page": 1, "limit": 20, "total": 150, "totalPages": 8, "hasNext": true, "hasPrev": false }
```

## File Uploads
- Use multer middleware with type-specific handlers
- Image: max 5MB, jpg/png/webp
- Document: max 10MB, pdf/doc/docx
- Resume: max 5MB, pdf/doc/docx
- Files saved to `uploads/<type>/` with unique names
