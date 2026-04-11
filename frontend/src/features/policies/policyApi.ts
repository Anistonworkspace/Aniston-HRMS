import { api } from '../../app/api';

export const policyApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPolicies: builder.query<any, { category?: string } | void>({
      query: (params) => ({ url: '/policies', params: params || undefined }),
      providesTags: (result) =>
        result?.data
          ? [
              ...result.data.map((p: any) => ({ type: 'Policy' as const, id: p.id })),
              { type: 'Policy', id: 'LIST' },
            ]
          : [{ type: 'Policy', id: 'LIST' }],
    }),
    getPolicy: builder.query<any, string>({
      query: (id) => `/policies/${id}`,
      providesTags: (result, error, id) => [{ type: 'Policy', id }],
    }),
    createPolicy: builder.mutation<any, FormData>({
      query: (body) => ({ url: '/policies', method: 'POST', body }),
      invalidatesTags: [{ type: 'Policy', id: 'LIST' }],
    }),
    updatePolicy: builder.mutation<any, { id: string; data: FormData }>({
      query: ({ id, data }) => ({ url: `/policies/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Policy', id }, { type: 'Policy', id: 'LIST' }],
    }),
    deletePolicy: builder.mutation<any, string>({
      query: (id) => ({ url: `/policies/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Policy', id: 'LIST' }],
    }),
    acknowledgePolicy: builder.mutation<any, string>({
      query: (id) => ({ url: `/policies/${id}/acknowledge`, method: 'POST' }),
      invalidatesTags: (result, error, id) => [{ type: 'Policy', id }, { type: 'Policy', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetPoliciesQuery,
  useGetPolicyQuery,
  useCreatePolicyMutation,
  useUpdatePolicyMutation,
  useDeletePolicyMutation,
  useAcknowledgePolicyMutation,
} = policyApi;
