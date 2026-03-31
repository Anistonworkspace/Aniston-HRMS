import { api } from '../../app/api';

export const onboardingApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Token-based (public) onboarding
    getOnboardingStatus: builder.query<any, string>({
      query: (token) => `/onboarding/status/${token}`,
    }),
    saveOnboardingStep: builder.mutation<any, { token: string; step: number; data: any }>({
      query: ({ token, step, data }) => ({
        url: `/onboarding/step/${token}/${step}`,
        method: 'PATCH',
        body: data,
      }),
    }),
    completeOnboarding: builder.mutation<any, string>({
      query: (token) => ({
        url: `/onboarding/complete/${token}`,
        method: 'POST',
      }),
    }),
    createOnboardingInvite: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/invite/${employeeId}`,
        method: 'POST',
      }),
    }),
    getPendingInvites: builder.query<any, void>({
      query: () => '/onboarding/invites',
    }),

    // Authenticated (post-login) onboarding
    getMyOnboardingStatus: builder.query<any, void>({
      query: () => '/onboarding/my-status',
      providesTags: ['Onboarding'],
    }),
    saveMyStep: builder.mutation<any, { step: number; data: any }>({
      query: ({ step, data }) => ({
        url: `/onboarding/my-step/${step}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: ['Onboarding'],
    }),
    completeMyOnboarding: builder.mutation<any, void>({
      query: () => ({
        url: '/onboarding/my-complete',
        method: 'POST',
      }),
      invalidatesTags: ['Onboarding'],
    }),
  }),
});

export const {
  useGetOnboardingStatusQuery,
  useSaveOnboardingStepMutation,
  useCompleteOnboardingMutation,
  useCreateOnboardingInviteMutation,
  useGetPendingInvitesQuery,
  useGetMyOnboardingStatusQuery,
  useSaveMyStepMutation,
  useCompleteMyOnboardingMutation,
} = onboardingApi;
