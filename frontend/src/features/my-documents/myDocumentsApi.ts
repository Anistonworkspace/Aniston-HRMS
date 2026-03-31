import { api } from '../../app/api';

export const myDocumentsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyDocuments: builder.query<any, void>({
      query: () => '/documents/my',
      providesTags: ['Document'],
    }),
    issueLetterDocument: builder.mutation<any, { employeeId: string; type: string }>({
      query: ({ employeeId, type }) => ({
        url: `/documents/issue/${employeeId}`,
        method: 'POST',
        body: { type },
      }),
      invalidatesTags: ['Document'],
    }),
  }),
});

export const { useGetMyDocumentsQuery, useIssueLetterDocumentMutation } = myDocumentsApi;
