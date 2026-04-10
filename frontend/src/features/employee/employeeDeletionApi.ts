import { api } from '../../app/api';

export interface DeletionRequest {
  id: string;
  organizationId: string;
  employeeId: string | null;
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  requestedById: string;
  requestedByName: string;
  requestedByRole: string;
  reason: string;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const employeeDeletionApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // HR: create deletion request
    createDeletionRequest: builder.mutation<
      { success: boolean; data: DeletionRequest },
      { employeeId: string; reason: string; notes?: string }
    >({
      query: ({ employeeId, reason, notes }) => ({
        url: `/employee-deletion-requests/${employeeId}`,
        method: 'POST',
        body: { reason, notes },
      }),
      invalidatesTags: ['DeletionRequests'],
    }),

    // Super Admin: list all requests
    getDeletionRequests: builder.query<
      { success: boolean; data: DeletionRequest[]; meta: any },
      { page?: number; limit?: number; status?: string }
    >({
      query: (params) => ({ url: '/employee-deletion-requests', params }),
      providesTags: ['DeletionRequests'],
    }),

    // Super Admin: approve → deletes employee
    approveDeletionRequest: builder.mutation<
      { success: boolean; data: DeletionRequest; message: string },
      string
    >({
      query: (requestId) => ({
        url: `/employee-deletion-requests/request/${requestId}/approve`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['DeletionRequests', 'EmployeeList', 'Dashboard'],
    }),

    // Super Admin: reject
    rejectDeletionRequest: builder.mutation<
      { success: boolean; data: DeletionRequest; message: string },
      { requestId: string; rejectionReason?: string }
    >({
      query: ({ requestId, rejectionReason }) => ({
        url: `/employee-deletion-requests/request/${requestId}/reject`,
        method: 'POST',
        body: { rejectionReason },
      }),
      invalidatesTags: ['DeletionRequests'],
    }),

    // Super Admin: dismiss a completed (non-PENDING) deletion request
    dismissDeletionRequest: builder.mutation<
      { success: boolean; message: string },
      string
    >({
      query: (requestId) => ({
        url: `/employee-deletion-requests/request/${requestId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['DeletionRequests'],
    }),

    // Super Admin: direct permanent delete
    permanentDeleteEmployee: builder.mutation<
      { success: boolean; data: any; message: string },
      { employeeId: string; reason: string }
    >({
      query: ({ employeeId, reason }) => ({
        url: `/employees/${employeeId}/permanent-delete`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['EmployeeList', 'Dashboard', 'DeletionRequests'],
    }),
  }),
});

export const {
  useCreateDeletionRequestMutation,
  useGetDeletionRequestsQuery,
  useApproveDeletionRequestMutation,
  useRejectDeletionRequestMutation,
  useDismissDeletionRequestMutation,
  usePermanentDeleteEmployeeMutation,
} = employeeDeletionApi;
