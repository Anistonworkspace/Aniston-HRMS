---
scope: prisma/**
description: Database and Prisma rules for Aniston HRMS
---

# Database Rules

## Model Requirements
Every new model MUST have:
```prisma
model Example {
  id        String   @id @default(uuid())
  // ... fields ...
  organizationId String  // Required for multi-tenant
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime? // Soft delete
}
```

## Conventions
- IDs: Always `String @id @default(uuid())` — never Int
- Enums: Add to BOTH `schema.prisma` AND `shared/src/enums.ts`
- Indexes: Always add `@@index` on `organizationId` + commonly filtered fields
- Relations: `onDelete: Restrict` for User references (never Cascade)
- Sensitive fields: suffix with `Encrypted` (e.g., `aadhaarEncrypted`)

## Commands
```bash
npx prisma generate    # After ANY schema change — regenerates client
npx prisma db push     # Dev only — sync schema to DB
npx prisma migrate dev # Create migration (for production-ready changes)
npx prisma db seed     # Run seed script
npx prisma studio      # GUI database browser
```

## Production
- NEVER use `db:push` in production — always use `migrate deploy`
- NEVER edit migration files after they're created
- Always backup database before running migrations
