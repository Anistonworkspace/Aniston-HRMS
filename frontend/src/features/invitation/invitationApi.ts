import { api } from '../../app/api';

export const invitationApi = api.injectEndpoints({
  endpoints: (builder) => ({
    createInvitation: builder.mutation<any, { email?: string; mobileNumber?: string }>({
      query: (body) => ({ url: '/invitations', method: 'POST', body }),
      invalidatesTags: ['Invitation', 'EmployeeList'],
    }),
    getInvitations: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/invitations', params }),
      providesTags: ['Invitation'],
    }),
    validateInvitation: builder.query<any, string>({
      query: (token) => `/invitations/validate/${token}`,
    }),
    completeInvitation: builder.mutation<any, { token: string; data: { firstName: string; lastName: string; email: string; phone: string; password: string } }>({
      query: ({ token, data }) => ({ url: `/invitations/complete/${token}`, method: 'PATCH', body: data }),
    }),
    resendInvitation: builder.mutation<any, string>({
      query: (id) => ({ url: `/invitations/${id}/resend`, method: 'POST' }),
      invalidatesTags: ['Invitation'],
    }),
  }),
});

export const {
  useCreateInvitationMutation,
  useGetInvitationsQuery,
  useValidateInvitationQuery,
  useCompleteInvitationMutation,
  useResendInvitationMutation,
} = invitationApi;
