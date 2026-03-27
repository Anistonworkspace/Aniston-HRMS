---
name: new-module
description: Scaffold a complete new backend + frontend module
---

# New Module Scaffolding

When invoked with `/new-module <name>`, create all files for a new HRMS module.

## Backend Files

### 1. `backend/src/modules/<name>/<name>.routes.ts`
```typescript
import { Router } from 'express';
import { <name>Controller } from './<name>.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { validateRequest } from '../../middleware/validation.js';
import { Create<Name>Schema, Update<Name>Schema } from './<name>.validation.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('<name>', 'read'), (req, res, next) => <name>Controller.getAll(req, res, next));
router.get('/:id', requirePermission('<name>', 'read'), (req, res, next) => <name>Controller.getById(req, res, next));
router.post('/', requirePermission('<name>', 'create'), validateRequest(Create<Name>Schema), (req, res, next) => <name>Controller.create(req, res, next));
router.patch('/:id', requirePermission('<name>', 'update'), validateRequest(Update<Name>Schema), (req, res, next) => <name>Controller.update(req, res, next));
router.delete('/:id', requirePermission('<name>', 'delete'), (req, res, next) => <name>Controller.remove(req, res, next));

export { router as <name>Router };
```

### 2. Create controller, service, validation following the same pattern

### 3. Register in `backend/src/app.ts`:
```typescript
app.use('/api/<name>s', <name>Router);
```

## Frontend Files

### 4. `frontend/src/features/<name>/<name>Api.ts` — RTK Query endpoints
### 5. `frontend/src/features/<name>/<Name>Page.tsx` — List + detail page
### 6. Add route to `frontend/src/router/AppRouter.tsx`
### 7. Add nav item to `frontend/src/components/layout/Sidebar.tsx`

## Database
### 8. Add Prisma model to `prisma/schema.prisma`
### 9. Run: `npx prisma db push && npx prisma generate`

## Permissions
### 10. Add resource to `shared/src/permissions.ts` for each role
