import { api } from '../../app/api';

export const onboardingApi = api.injectEndpoints({
  endpoints: (builder) => ({
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
  }),
});

export const {
  useGetOnboardingStatusQuery,
  useSaveOnboardingStepMutation,
  useCompleteOnboardingMutation,
  useCreateOnboardingInviteMutation,
  useGetPendingInvitesQuery,
} = onboardingApi;
