---
name: fix-p2-p3-enterprise
description: "Execute P2 and P3 fix plans: partial feature issues, UX improvements, performance optimizations, missing tests. Follows safe-fix-plan-rules."
---

# P2/P3 Fix Execution — Aniston HRMS

Use `safe-fix-plan-rules.md` format. Follows standard PR process (not emergency protocol).

## P2 Fix Protocol (Partial Feature Broken / UX Degraded)
1. Confirm the fix scope with user
2. Apply the minimal code change
3. Add unit test for the fixed scenario
4. Run lint + typecheck
5. Report changes made

## P3 Fix Protocol (Minor Issue / Optimization)
1. Apply fix
2. Test passes
3. Report

## Common P2 Fix Patterns

### Fix: Stale RTK Query modal data
```typescript
// BEFORE: stale closure over selected item
const [selected, setSelected] = useState(null);
const handleEdit = (employee) => { setSelected(employee); setOpen(true); };

// AFTER: derive fresh data from RTK cache by ID
const [selectedId, setSelectedId] = useState<string | null>(null);
const { data: selected } = useGetEmployeeQuery(selectedId!, { skip: !selectedId });
const handleEdit = (employee) => { setSelectedId(employee.id); setOpen(true); };
```

### Fix: Missing loading state
```typescript
// Add loading skeleton
if (isLoading) return <TableSkeleton rows={5} columns={4} />;
if (isError) return <ErrorMessage message="Failed to load employees" onRetry={refetch} />;
if (!data?.length) return <EmptyState title="No employees found" />;
return <EmployeeTable data={data} />;
```

### Fix: Missing empty state
```typescript
// After the loading/error checks:
if (data.length === 0) {
  return (
    <div className="flex flex-col items-center py-12 text-gray-500">
      <Users className="w-12 h-12 mb-3 opacity-30" />
      <p className="font-medium">No leave requests found</p>
      <p className="text-sm mt-1">Apply for leave to see it here.</p>
    </div>
  );
}
```

### Fix: Mobile overflow
```typescript
// Wrap table in scrollable container
<div className="overflow-x-auto -mx-4 sm:mx-0">
  <table className="min-w-full divide-y divide-gray-200">
    {/* ... */}
  </table>
</div>
```

### Fix: Missing pagination
```typescript
// Add pagination to unbounded list
const [page, setPage] = useState(1);
const { data } = useGetEmployeesQuery({ page, limit: 20, organizationId });
// data.meta.total, data.meta.totalPages available for pagination controls
```

### Fix: N+1 query
```typescript
// BEFORE: N+1 in service
const employees = await prisma.employee.findMany({ where: { organizationId } });
for (const emp of employees) {
  emp.leaveBalance = await prisma.leaveBalance.findFirst({ where: { employeeId: emp.id } });
}

// AFTER: eager load
const employees = await prisma.employee.findMany({
  where: { organizationId, deletedAt: null },
  include: {
    leaveBalance: { where: { year: currentYear } },
    shift: true
  },
  take: limit,
  skip: (page - 1) * limit
});
```

### Fix: Missing index in schema
```prisma
// Add to prisma/schema.prisma
model AttendanceRecord {
  // ... existing fields ...
  @@index([organizationId])
  @@index([employeeId, date])  // Add this
  @@index([organizationId, date])  // Add this for org-wide daily queries
}
```

### Fix: Missing confirmations for destructive actions
```typescript
// Add AlertDialog before destructive action
<AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this employee?</AlertDialogTitle>
      <AlertDialogDescription>
        This will initiate a deletion approval workflow.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete} className="bg-red-600">
        Yes, delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## Batch Fix Approach for Systemic Issues
If the same pattern appears in 5+ places (e.g., missing loading states across all pages):
1. Fix one as a template
2. Show user the template
3. Get approval to apply pattern across all instances
4. Apply to all instances at once
5. Write one test that covers the pattern

## After P2/P3 Fixes
- Run `npm run typecheck` — no type errors
- Run `npm run lint` — no lint errors
- Run relevant test file
- Report: "Fixed X issues. Files changed: [list]. Tests added: [list]."
- Do NOT commit/push without explicit instruction