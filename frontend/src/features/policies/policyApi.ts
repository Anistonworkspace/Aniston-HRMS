import { api } from '../../app/api';

export const policyApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPolicies: builder.query<any, { category?: string }>({
      query: (params) => ({ url: '/policies', params }),
    }),
    getPolicy: builder.query<any, string>({
      query: (id) => `/policies/${id}`,
    }),
    acknowledgePolicy: builder.mutation<any, string>({
      query: (id) => ({ url: `/policies/${id}/acknowledge`, method: 'POST' }),
    }),
  }),
});

export const {
  useGetPoliciesQuery,
  useGetPolicyQuery,
  useAcknowledgePolicyMutation,
} = policyApi;
