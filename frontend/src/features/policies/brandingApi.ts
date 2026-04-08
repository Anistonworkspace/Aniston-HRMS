import { api } from '../../app/api';

export const brandingApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getBranding: builder.query<any, void>({
      query: () => '/branding',
      providesTags: ['Branding'],
    }),

    updateBranding: builder.mutation<any, { companyName?: string; companyAddress?: string }>({
      query: (body) => ({ url: '/branding', method: 'PATCH', body }),
      invalidatesTags: ['Branding'],
    }),

    uploadLogo: builder.mutation<any, FormData>({
      query: (body) => ({ url: '/branding/logo', method: 'POST', body }),
      invalidatesTags: ['Branding'],
    }),

    uploadSignature: builder.mutation<any, FormData>({
      query: (body) => ({ url: '/branding/signature', method: 'POST', body }),
      invalidatesTags: ['Branding'],
    }),

    uploadStamp: builder.mutation<any, FormData>({
      query: (body) => ({ url: '/branding/stamp', method: 'POST', body }),
      invalidatesTags: ['Branding'],
    }),
  }),
});

export const {
  useGetBrandingQuery,
  useUpdateBrandingMutation,
  useUploadLogoMutation,
  useUploadSignatureMutation,
  useUploadStampMutation,
} = brandingApi;
