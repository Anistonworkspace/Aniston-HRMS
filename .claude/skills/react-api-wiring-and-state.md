---
name: react-api-wiring-and-state
description: "Skill for React RTK Query wiring analysis: detect dead buttons, stale modal state, broken invalidations, missing loading/error states, API payload mismatches"
type: skill
---

# React API Wiring & State Skill — Aniston HRMS

## When to Use
Use when asked to:
- Find why a button doesn't work
- Debug why UI doesn't update after an action
- Find why a modal shows stale data
- Debug API call failures
- Audit RTK Query cache invalidation

## RTK Query Wiring Checklist

### Complete Mutation Pattern
```typescript
// CORRECT pattern for every mutation
const [doSomething, { isLoading, isError, error }] = useDoSomethingMutation();

const handleAction = async () => {
  try {
    const result = await doSomething(payload).unwrap(); // .unwrap() throws on error
    toast.success('Action completed');
    setOpen(false); // Close modal only on success
  } catch (err) {
    const message = (err as { data?: { error?: { message?: string } } })?.data?.error?.message;
    toast.error(message ?? 'Something went wrong');
    // Do NOT close modal on error
  }
};

<Button onClick={handleAction} disabled={isLoading}>
  {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : 'Save'}
</Button>
```

### Common Wiring Bugs

#### Bug 1: Button has no onClick
```tsx
// BROKEN
<Button>Approve Leave</Button>

// FIXED
<Button onClick={() => handleApprove(leave.id)}>Approve Leave</Button>
```

#### Bug 2: Mutation not called
```tsx
// BROKEN — mutation defined but not called
const [approveleave] = useApproveLeaveM­utation();
const handleApprove = (id: string) => {
  // Missing: approveLeave(id)
};

// FIXED
const handleApprove = async (id: string) => {
  await approveLeave({ id }).unwrap();
};
```

#### Bug 3: Stale modal data
```tsx
// BROKEN — uses stale closed-over state
const [selected, setSelected] = useState<Employee | null>(null);
const handleEdit = (emp: Employee) => {
  setSelected(emp); // This is a snapshot, not live data
  setOpen(true);
};
<EditModal employee={selected} />

// FIXED — derive from RTK Query cache by ID
const [selectedId, setSelectedId] = useState<string | null>(null);
const { data: employee } = useGetEmployeeQuery(selectedId!, { skip: !selectedId });
const handleEdit = (emp: Employee) => { setSelectedId(emp.id); setOpen(true); };
<EditModal employee={employee} isOpen={!!selectedId} onClose={() => setSelectedId(null)} />
```

#### Bug 4: Missing invalidation
```typescript
// BROKEN — approving leave doesn't update balance shown to employee
approveLeave: builder.mutation({
  query: (id) => ({ url: `/leaves/${id}/approve`, method: 'PATCH' }),
  invalidatesTags: ['LeaveRequests'],
  // Missing: 'LeaveBalance' — employee's balance won't update
}),

// FIXED
invalidatesTags: (result, error, id) => [
  { type: 'LeaveRequests' as const },
  { type: 'LeaveBalance' as const },
  { type: 'EmployeeStats' as const },
],
```

#### Bug 5: Modal doesn't reset on open
```tsx
// BROKEN — form shows previous values when reopened
const [open, setOpen] = useState(false);
const { register, handleSubmit } = useForm();
// No reset on open change

// FIXED
const { register, handleSubmit, reset } = useForm();
useEffect(() => {
  if (open) reset(defaultValues);  // Reset form when modal opens
  if (!open) reset();              // Clear form when modal closes
}, [open]);
```

## API Payload Mismatch Detection

### Check RTK Query vs Express Route
```typescript
// RTK Query (frontend)
createLeave: builder.mutation({
  query: (data: { startDate: string; endDate: string; leaveTypeId: string; reason?: string }) => ({
    url: '/leaves',
    method: 'POST',
    body: data,
  }),
}),

// Zod schema (backend) — must match
const createLeaveSchema = z.object({
  startDate: z.string().datetime(),  // ← matches 'startDate' in RTK
  endDate: z.string().datetime(),    // ← matches 'endDate' in RTK
  leaveTypeId: z.string().uuid(),    // ← matches 'leaveTypeId' in RTK
  reason: z.string().optional(),     // ← matches 'reason?' in RTK
});

// If Zod schema has 'leaveTypId' (typo) but RTK sends 'leaveTypeId':
// → 400 validation error every time, user can't apply leave
```

### Response Envelope Handling
```typescript
// Backend returns: { success: true, data: { employees: [...], meta: {...} } }
// RTK Query base API unwraps correctly:

getEmployees: builder.query({
  query: (params) => `/employees?page=${params.page}&limit=${params.limit}`,
  // If baseQuery uses transformResponse to unwrap envelope, data = employees array
  // If not, component must access data.data.employees — check baseApi setup
}),
```

## Common Loading/Error/Empty State Templates

```tsx
// Standard pattern for every list component:
const { data, isLoading, isError, refetch } = useGetSomethingQuery(params);

if (isLoading) {
  return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
}

if (isError) {
  return (
    <div className="flex flex-col items-center py-8 text-red-500">
      <AlertCircle className="w-8 h-8 mb-2" />
      <p>Failed to load data</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>Retry</Button>
    </div>
  );
}

if (!data || data.length === 0) {
  return (
    <div className="flex flex-col items-center py-12 text-gray-400">
      <InboxIcon className="w-12 h-12 mb-3" />
      <p className="font-medium">No records found</p>
    </div>
  );
}

return <DataList items={data} />;
```

## Socket → Redux → UI Update Pattern (KYC)
```typescript
// AppShell.tsx — Socket listener for KYC status change
useEffect(() => {
  if (!socket || !user) return;
  
  socket.on('kyc:status-changed', ({ kycCompleted, status }: { kycCompleted: boolean; status: string }) => {
    dispatch(setUser({ ...user, kycCompleted }));
    if (!kycCompleted) {
      toast.error('Your document access has been updated. Please re-upload required documents.');
    }
  });
  
  return () => { socket.off('kyc:status-changed'); };
}, [socket, user, dispatch]);
```

## RTK Tag Naming Convention
```typescript
// Consistent tag names across all API files:
providesTags: (result, error, employeeId) => [
  { type: 'Employee' as const, id: employeeId },
  { type: 'EmployeeList' as const },
],

invalidatesTags: [
  { type: 'Employee', id: employeeId },
  'EmployeeList',
  'LeaveBalance',
  'PayrollStats',
],
```