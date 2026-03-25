import { api } from '../../app/api';

export const assetApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAssets: builder.query<any, { page?: number; limit?: number; category?: string; status?: string; search?: string }>({
      query: (params) => ({ url: '/assets', params }),
      providesTags: ['Asset'],
    }),
    getAssetById: builder.query<any, string>({
      query: (id) => `/assets/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Asset', id }],
    }),
    createAsset: builder.mutation<any, any>({
      query: (body) => ({ url: '/assets', method: 'POST', body }),
      invalidatesTags: ['Asset'],
    }),
    updateAsset: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/assets/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['Asset'],
    }),
    assignAsset: builder.mutation<any, { assetId: string; employeeId: string; condition?: string; notes?: string }>({
      query: ({ assetId, ...body }) => ({ url: `/assets/${assetId}/assign`, method: 'POST', body }),
      invalidatesTags: ['Asset'],
    }),
    returnAsset: builder.mutation<any, { assignmentId: string; returnCondition?: string; returnNotes?: string }>({
      query: ({ assignmentId, ...body }) => ({ url: `/assets/assignments/${assignmentId}/return`, method: 'PATCH', body }),
      invalidatesTags: ['Asset', 'Exit'],
    }),
    getAssetAssignments: builder.query<any, string>({
      query: (assetId) => `/assets/${assetId}/assignments`,
      providesTags: ['Asset'],
    }),
    getMyAssets: builder.query<any, void>({
      query: () => '/assets/my',
      providesTags: ['Asset'],
    }),
    getAssetStats: builder.query<any, void>({
      query: () => '/assets/stats',
      providesTags: ['Asset'],
    }),
    getEmployeeAssets: builder.query<any, string>({
      query: (employeeId) => `/assets/employee/${employeeId}`,
      providesTags: ['Asset'],
    }),
    getExitChecklist: builder.query<any, string>({
      query: (employeeId) => `/assets/exit-checklist/${employeeId}`,
      providesTags: ['Asset', 'Exit'],
    }),
    markChecklistItem: builder.mutation<any, { employeeId: string; itemId: string; isReturned: boolean; notes?: string }>({
      query: ({ employeeId, ...body }) => ({ url: `/assets/exit-checklist/${employeeId}/item`, method: 'PATCH', body }),
      invalidatesTags: ['Asset', 'Exit'],
    }),
  }),
});

export const {
  useGetAssetsQuery,
  useGetAssetByIdQuery,
  useCreateAssetMutation,
  useUpdateAssetMutation,
  useAssignAssetMutation,
  useReturnAssetMutation,
  useGetAssetAssignmentsQuery,
  useGetMyAssetsQuery,
  useGetAssetStatsQuery,
  useGetEmployeeAssetsQuery,
  useGetExitChecklistQuery,
  useMarkChecklistItemMutation,
} = assetApi;
