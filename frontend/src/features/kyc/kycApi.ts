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

    // HR: KYC statistics (counts per status for the org header)
    getKycStats: builder.query<any, void>({
      query: () => '/onboarding/kyc/stats',
      providesTags: ['Kyc'],
      keepUnusedDataFor: 60,
    }),

    // HR: list pending/submitted KYC submissions
    getPendingKyc: builder.query<any, { page?: number }>({
      query: (params) => ({ url: '/onboarding/kyc/pending', params }),
      providesTags: ['Kyc'],
    }),

    // HR: get full KYC review data for one employee (gate + all docs + OCR + analysis)
    // keepUnusedDataFor=300s so navigating back from the detail view hits cache (Cat 5 item 21)
    getKycHrReview: builder.query<any, string>({
      query: (employeeId) => `/onboarding/kyc/${employeeId}/hr-review`,
      providesTags: (_r, _e, id) => [{ type: 'Kyc', id }],
      keepUnusedDataFor: 300,
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

    // HR: revoke portal access after KYC was VERIFIED (e.g. offboarding or fraud)
    revokeKycAccess: builder.mutation<any, string>({
      query: (employeeId) => ({ url: `/onboarding/kyc/${employeeId}/revoke-kyc`, method: 'POST' }),
      invalidatesTags: ['Kyc'],
    }),

    // HR: stream a single document via authenticated proxy (no direct URL, no download)
    viewKycDocument: builder.query<string, { employeeId: string; docId: string }>({
      query: ({ employeeId, docId }) => ({
        url: `/onboarding/kyc/${employeeId}/document/${docId}/view`,
        responseHandler: async (response: Response) => {
          const blob = await response.blob();
          return URL.createObjectURL(blob);
        },
        cache: 'no-cache',
      }),
    }),

    // HR: KYC audit log — full action history for an employee (Category 4 item 15)
    getKycAuditLog: builder.query<any, string>({
      query: (employeeId) => `/onboarding/kyc/${employeeId}/audit-log`,
      providesTags: (_r, _e, id) => [{ type: 'Kyc', id }],
    }),

    // HR: check for duplicate Aadhaar/PAN across all employees (Category 2 item 8)
    checkDuplicateDocument: builder.mutation<any, { employeeId: string; aadhaarNumber?: string; panNumber?: string; passportNumber?: string }>({
      query: ({ employeeId, ...body }) => ({
        url: `/onboarding/kyc/${employeeId}/check-duplicate`,
        method: 'POST',
        body,
      }),
    }),

    // Admin: trigger KYC expiry check for the org (moves expired VERIFIED → REUPLOAD_REQUIRED)
    triggerKycExpiryCheck: builder.mutation<any, void>({
      query: () => ({ url: '/onboarding/kyc/expiry-check', method: 'POST' }),
      invalidatesTags: ['Kyc'],
    }),

    // HR: download KYC completion certificate for a verified employee
    getKycCompletionCertificate: builder.query<Blob, string>({
      query: (employeeId) => ({
        url: `/onboarding/kyc/${employeeId}/completion-certificate`,
        responseHandler: (response: Response) => response.blob(),
        cache: 'no-cache',
      }),
    }),

    // Admin: get org-wide KYC compliance report
    getKycComplianceReport: builder.query<any, void>({
      query: () => '/onboarding/kyc/compliance-report',
      providesTags: ['Kyc'],
    }),

    // Admin: trigger SLA escalation check (notifies supervisor about overdue submissions)
    triggerSlaCheck: builder.mutation<any, void>({
      query: () => ({ url: '/onboarding/kyc/sla-check', method: 'POST' }),
    }),

    // HR: bulk verify multiple employees
    bulkVerifyKyc: builder.mutation<any, { employeeIds: string[] }>({
      query: (body) => ({ url: '/onboarding/kyc/bulk-verify', method: 'POST', body }),
      invalidatesTags: ['Kyc'],
    }),

    // HR: bulk request re-upload for multiple employees
    bulkRequestReupload: builder.mutation<any, { employeeIds: string[]; docTypes: string[]; reason: string }>({
      query: (body) => ({ url: '/onboarding/kyc/bulk-request-reupload', method: 'POST', body }),
      invalidatesTags: ['Kyc'],
    }),
  }),
});

export const {
  useGetKycStatsQuery,
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
  useRevokeKycAccessMutation,
  useViewKycDocumentQuery,
  useGetKycAuditLogQuery,
  useCheckDuplicateDocumentMutation,
  useTriggerKycExpiryCheckMutation,
  useGetKycCompletionCertificateQuery,
  useGetKycComplianceReportQuery,
  useTriggerSlaCheckMutation,
  useBulkVerifyKycMutation,
  useBulkRequestReuploadMutation,
} = kycApi;
