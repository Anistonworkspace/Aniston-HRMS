import { api } from '../../app/api';

export const kycApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyKycStatus: builder.query<any, void>({
      query: () => '/onboarding/kyc/me',
      providesTags: ['Kyc'],
    }),
    uploadKycDocument: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/documents?employeeId=${employeeId}`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),
    uploadKycPhoto: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/photo`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),
    uploadCombinedPdf: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/combined-pdf`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),
    uploadPhotoFile: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/photo-upload`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),
    submitKyc: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/submit`,
        method: 'POST',
      }),
      invalidatesTags: ['Kyc'],
    }),
    getPendingKyc: builder.query<any, { page?: number }>({
      query: (params) => ({ url: '/onboarding/kyc/pending', params }),
      providesTags: ['Kyc'],
    }),
    verifyKyc: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/verify`,
        method: 'POST',
      }),
      invalidatesTags: ['Kyc', 'Employee'],
    }),
    rejectKyc: builder.mutation<any, { employeeId: string; reason: string }>({
      query: ({ employeeId, reason }) => ({
        url: `/onboarding/kyc/${employeeId}/reject`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['Kyc', 'Employee'],
    }),
  }),
});

export const {
  useGetMyKycStatusQuery,
  useUploadKycDocumentMutation,
  useUploadKycPhotoMutation,
  useUploadCombinedPdfMutation,
  useUploadPhotoFileMutation,
  useSubmitKycMutation,
  useGetPendingKycQuery,
  useVerifyKycMutation,
  useRejectKycMutation,
} = kycApi;
