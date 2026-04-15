import { api } from '../../app/api';

export const kycApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Employee: get own KYC status (with per-doc statuses and reupload info)
    getMyKycStatus: builder.query<any, void>({
      query: () => '/onboarding/kyc/me',
      providesTags: ['Kyc'],
    }),

    // Employee: save upload mode + fresher/experienced + qualification before uploading
    saveKycConfig: builder.mutation<any, {
      employeeId: string;
      uploadMode: 'COMBINED' | 'SEPARATE';
      fresherOrExperienced: 'FRESHER' | 'EXPERIENCED';
      highestQualification: 'TENTH' | 'TWELFTH' | 'GRADUATION' | 'POST_GRADUATION' | 'PHD';
    }>({
      query: ({ employeeId, ...body }) => ({
        url: `/onboarding/kyc/${employeeId}/config`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Kyc'],
    }),

    // Employee / HR: upload a single KYC document
    uploadKycDocument: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/documents?employeeId=${employeeId}`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),

    // Employee / HR: upload KYC passport photo via camera blob
    uploadKycPhoto: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/photo`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),

    // Employee / HR: upload combined PDF
    uploadCombinedPdf: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/combined-pdf`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),

    // Employee / HR: upload passport photo as file (alternative to camera)
    uploadPhotoFile: builder.mutation<any, { employeeId: string; formData: FormData }>({
      query: ({ employeeId, formData }) => ({
        url: `/onboarding/kyc/${employeeId}/photo-upload`,
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['Kyc'],
    }),

    // Employee: submit KYC for HR review
    submitKyc: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/submit`,
        method: 'POST',
      }),
      invalidatesTags: ['Kyc'],
    }),

    // HR: list pending/submitted KYC submissions
    getPendingKyc: builder.query<any, { page?: number }>({
      query: (params) => ({ url: '/onboarding/kyc/pending', params }),
      providesTags: ['Kyc'],
    }),

    // HR: get full KYC review data for one employee (gate + all docs + OCR + analysis)
    getKycHrReview: builder.query<any, string>({
      query: (employeeId) => `/onboarding/kyc/${employeeId}/hr-review`,
      providesTags: (_r, _e, id) => [{ type: 'Kyc', id }],
    }),

    // HR: approve (verify) KYC
    verifyKyc: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/verify`,
        method: 'POST',
      }),
      invalidatesTags: ['Kyc', 'Employee'],
    }),

    // HR: reject whole KYC submission
    rejectKyc: builder.mutation<any, { employeeId: string; reason: string }>({
      query: ({ employeeId, reason }) => ({
        url: `/onboarding/kyc/${employeeId}/reject`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['Kyc', 'Employee'],
    }),

    // HR: request re-upload of specific document types with per-doc reasons
    requestReupload: builder.mutation<any, {
      employeeId: string;
      docTypes: string[];
      reasons: Record<string, string>;
    }>({
      query: ({ employeeId, docTypes, reasons }) => ({
        url: `/onboarding/kyc/${employeeId}/request-reupload`,
        method: 'POST',
        body: { docTypes, reasons },
      }),
      invalidatesTags: ['Kyc', 'Employee'],
    }),

    // HR: update internal review notes
    updateHrNotes: builder.mutation<any, { employeeId: string; notes: string }>({
      query: ({ employeeId, notes }) => ({
        url: `/onboarding/kyc/${employeeId}/hr-notes`,
        method: 'PATCH',
        body: { notes },
      }),
      invalidatesTags: [{ type: 'Kyc' }],
    }),

    // HR: manually retrigger OCR for all employee documents
    retriggerOcr: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/retrigger-ocr`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Kyc' }],
    }),

    // HR: re-run combined PDF classification (Python → Node.js fallback, synchronous)
    reclassifyCombinedPdf: builder.mutation<any, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/reclassify-combined-pdf`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Kyc' }],
    }),
  }),
});

export const {
  useGetMyKycStatusQuery,
  useSaveKycConfigMutation,
  useUploadKycDocumentMutation,
  useUploadKycPhotoMutation,
  useUploadCombinedPdfMutation,
  useUploadPhotoFileMutation,
  useSubmitKycMutation,
  useGetPendingKycQuery,
  useGetKycHrReviewQuery,
  useVerifyKycMutation,
  useRejectKycMutation,
  useRequestReuploadMutation,
  useUpdateHrNotesMutation,
  useRetriggerOcrMutation,
  useReclassifyCombinedPdfMutation,
} = kycApi;
