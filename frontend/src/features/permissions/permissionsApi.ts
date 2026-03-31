import { api } from '../../app/api';

export const permissionsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPresets: builder.query<any, void>({
      query: () => '/employee-permissions/presets',
      providesTags: ['PermissionPresets'],
    }),
    upsertPreset: builder.mutation<any, Record<string, any>>({
      query: (body) => ({
        url: '/employee-permissions/presets',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['PermissionPresets'],
    }),
    getOverride: builder.query<any, string>({
      query: (employeeId) => `/employee-permissions/overrides/${employeeId}`,
      providesTags: (_result, _error, id) => [{ type: 'PermissionOverrides', id }],
    }),
    upsertOverride: builder.mutation<any, { employeeId: string; body: Record<string, any> }>({
      query: ({ employeeId, body }) => ({
        url: `/employee-permissions/overrides/${employeeId}`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { employeeId }) => [
        { type: 'PermissionOverrides', id: employeeId },
      ],
    }),
    deleteOverride: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/employee-permissions/overrides/${employeeId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, employeeId) => [
        { type: 'PermissionOverrides', id: employeeId },
      ],
    }),
    getMyPermissions: builder.query<any, void>({
      query: () => '/employee-permissions/me',
      providesTags: ['MyPermissions'],
    }),
  }),
});

export const {
  useGetPresetsQuery,
  useUpsertPresetMutation,
  useGetOverrideQuery,
  useUpsertOverrideMutation,
  useDeleteOverrideMutation,
  useGetMyPermissionsQuery,
} = permissionsApi;
