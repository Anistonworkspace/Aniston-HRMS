import { api } from '../../app/api';

export const componentMasterApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getComponents: builder.query<any, { type?: string } | void>({
      query: (params) => ({
        url: '/salary-components',
        params: params || undefined,
      }),
      providesTags: ['SalaryTemplate'],
    }),

    getComponent: builder.query<any, string>({
      query: (id) => `/salary-components/${id}`,
      providesTags: ['SalaryTemplate'],
    }),

    createComponent: builder.mutation<any, {
      name: string; code: string; type: string;
      category?: string; calculationRule?: string; percentageOf?: string;
      defaultValue?: number; defaultPercentage?: number;
      isTaxable?: boolean; isStatutory?: boolean; sortOrder?: number; description?: string;
    }>({
      query: (body) => ({ url: '/salary-components', method: 'POST', body }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    updateComponent: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/salary-components/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    deleteComponent: builder.mutation<any, string>({
      query: (id) => ({ url: `/salary-components/${id}`, method: 'DELETE' }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    toggleComponent: builder.mutation<any, string>({
      query: (id) => ({ url: `/salary-components/${id}/toggle`, method: 'PATCH' }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    reorderComponents: builder.mutation<any, { components: { id: string; sortOrder: number }[] }>({
      query: (body) => ({ url: '/salary-components/reorder', method: 'POST', body }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    seedComponents: builder.mutation<any, void>({
      query: () => ({ url: '/salary-components/seed', method: 'POST' }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    cleanupLegacyComponents: builder.mutation<any, void>({
      query: () => ({ url: '/salary-components/cleanup-defaults', method: 'POST' }),
      invalidatesTags: ['SalaryTemplate'],
    }),
  }),
});

export const {
  useGetComponentsQuery,
  useGetComponentQuery,
  useCreateComponentMutation,
  useUpdateComponentMutation,
  useDeleteComponentMutation,
  useToggleComponentMutation,
  useReorderComponentsMutation,
  useSeedComponentsMutation,
  useCleanupLegacyComponentsMutation,
} = componentMasterApi;
