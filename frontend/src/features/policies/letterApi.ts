import { api } from '../../app/api';

export const letterApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // HR: List all letters
    getLetters: builder.query<any, void>({
      query: () => '/letters',
      providesTags: (result) =>
        result?.data
          ? [
              ...result.data.map((l: any) => ({ type: 'Letter' as const, id: l.id })),
              { type: 'Letter', id: 'LIST' },
            ]
          : [{ type: 'Letter', id: 'LIST' }],
    }),

    // Get single letter
    getLetter: builder.query<any, string>({
      query: (id) => `/letters/${id}`,
      providesTags: (result, error, id) => [{ type: 'Letter', id }],
    }),

    // Employee: My assigned letters
    getMyLetters: builder.query<any, void>({
      query: () => '/letters/my',
      providesTags: [{ type: 'Letter', id: 'MY' }],
    }),

    // Get templates
    getLetterTemplates: builder.query<any, void>({
      query: () => '/letters/templates',
      providesTags: [{ type: 'Letter', id: 'TEMPLATES' }],
    }),

    // Create letter (generates PDF + assigns)
    createLetter: builder.mutation<any, Record<string, any>>({
      query: (body) => ({ url: '/letters', method: 'POST', body }),
      invalidatesTags: [{ type: 'Letter', id: 'LIST' }, { type: 'Letter', id: 'MY' }],
    }),

    // Assign letter to more employees
    assignLetter: builder.mutation<any, { id: string; body: Record<string, any> }>({
      query: ({ id, body }) => ({ url: `/letters/${id}/assign`, method: 'POST', body }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Letter', id },
        { type: 'Letter', id: 'LIST' },
        { type: 'Letter', id: 'MY' },
      ],
    }),

    // Update assignment permissions
    updateLetterAssignment: builder.mutation<any, { assignmentId: string; downloadAllowed: boolean }>({
      query: ({ assignmentId, downloadAllowed }) => ({
        url: `/letters/assignments/${assignmentId}`,
        method: 'PATCH',
        body: { downloadAllowed },
      }),
      invalidatesTags: [{ type: 'Letter', id: 'LIST' }, { type: 'Letter', id: 'MY' }],
    }),

    // Delete letter
    deleteLetter: builder.mutation<any, string>({
      query: (id) => ({ url: `/letters/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Letter', id: 'LIST' }, { type: 'Letter', id: 'MY' }],
    }),
  }),
});

export const {
  useGetLettersQuery,
  useGetLetterQuery,
  useGetMyLettersQuery,
  useGetLetterTemplatesQuery,
  useCreateLetterMutation,
  useAssignLetterMutation,
  useUpdateLetterAssignmentMutation,
  useDeleteLetterMutation,
} = letterApi;
