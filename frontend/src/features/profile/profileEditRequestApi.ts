import { api } from '../../app/api';

export interface ProfileEditRequest {
  id: string;
  employeeId: string;
  organizationId: string;
  category: 'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS' | 'EPF_DETAILS';
  requestedData: Record<string, any>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  hrNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  editWindowExpiresAt?: string;
  editAppliedAt?: string;
  createdAt: string;
  updatedAt: string;
  employee?: { firstName: string; lastName: string; employeeCode: string };
}

export interface ProfileCompletion {
  allComplete: boolean;
  sections: {
    personalDetails: boolean;
    address: boolean;
    emergencyContact: boolean;
    bankDetails: boolean;
    documents: boolean;
  };
  missingDocs: string[];
  missingDocLabels: string[];
  missingFields: {
    personalDetails: string[];
    address: string[];
    emergencyContact: string[];
    bankDetails: string[];
  };
  onboardingComplete: boolean;
}

export const profileEditRequestApi = api.injectEndpoints({
  endpoints: (builder) => ({
    createProfileEditRequest: builder.mutation<
      { success: boolean; data: ProfileEditRequest },
      { category: ProfileEditRequest['category']; requestedData: Record<string, any> }
    >({
      query: (body) => ({ url: '/profile-edit-requests', method: 'POST', body }),
      invalidatesTags: ['ProfileEditRequest'],
    }),

    getMyProfileEditRequests: builder.query<
      { success: boolean; data: ProfileEditRequest[] },
      void
    >({
      query: () => '/profile-edit-requests/my',
      providesTags: ['ProfileEditRequest'],
    }),

    applyApprovedEdit: builder.mutation<
      { success: boolean; data: ProfileEditRequest },
      string
    >({
      query: (id) => ({ url: `/profile-edit-requests/${id}/apply`, method: 'POST' }),
      invalidatesTags: ['ProfileEditRequest', 'Employee'],
    }),

    getProfileEditRequestsForOrg: builder.query<
      { success: boolean; data: ProfileEditRequest[] },
      { status?: string; page?: number; limit?: number }
    >({
      query: (params) => ({ url: '/profile-edit-requests', params }),
      providesTags: ['ProfileEditRequest'],
    }),

    getProfileEditRequestsForEmployee: builder.query<
      { success: boolean; data: ProfileEditRequest[] },
      string
    >({
      query: (employeeId) => `/profile-edit-requests/employee/${employeeId}`,
      providesTags: (result, error, employeeId) => [
        { type: 'ProfileEditRequest', id: employeeId },
        'ProfileEditRequest',
      ],
      keepUnusedDataFor: 0,
    }),

    reviewProfileEditRequest: builder.mutation<
      { success: boolean; data: ProfileEditRequest },
      { id: string; status: 'APPROVED' | 'REJECTED'; hrNote?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/profile-edit-requests/${id}/review`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['ProfileEditRequest'],
    }),

    getProfileCompletion: builder.query<
      { success: boolean; data: ProfileCompletion },
      string | void
    >({
      query: (employeeId) =>
        employeeId
          ? `/profile-edit-requests/completion/${employeeId}`
          : '/profile-edit-requests/completion',
      providesTags: (result, error, arg) =>
        arg
          ? [{ type: 'ProfileEditRequest', id: `completion-${arg}` }]
          : ['ProfileEditRequest'],
    }),
  }),
});

export const {
  useCreateProfileEditRequestMutation,
  useGetMyProfileEditRequestsQuery,
  useApplyApprovedEditMutation,
  useGetProfileEditRequestsForOrgQuery,
  useGetProfileEditRequestsForEmployeeQuery,
  useReviewProfileEditRequestMutation,
  useGetProfileCompletionQuery,
} = profileEditRequestApi;
