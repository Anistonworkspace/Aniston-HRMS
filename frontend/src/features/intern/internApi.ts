import { api } from '../../app/api';

export const internApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getInternProfile: builder.query<any, string>({
      query: (employeeId) => `/interns/${employeeId}/profile`,
      providesTags: (_r, _e, id) => [{ type: 'Employee', id }],
    }),
    createInternProfile: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({ url: `/interns/${employeeId}/profile`, method: 'POST', body: data }),
      invalidatesTags: ['Employee'],
    }),
    updateInternProfile: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({ url: `/interns/${employeeId}/profile`, method: 'PATCH', body: data }),
      invalidatesTags: ['Employee'],
    }),
    getAchievementLetters: builder.query<any, string>({
      query: (employeeId) => `/interns/${employeeId}/achievement-letters`,
      providesTags: ['Employee'],
    }),
    issueAchievementLetter: builder.mutation<any, { employeeId: string; data: any }>({
      query: ({ employeeId, data }) => ({ url: `/interns/${employeeId}/achievement-letters`, method: 'POST', body: data }),
      invalidatesTags: ['Employee'],
    }),
  }),
});

export const {
  useGetInternProfileQuery,
  useCreateInternProfileMutation,
  useUpdateInternProfileMutation,
  useGetAchievementLettersQuery,
  useIssueAchievementLetterMutation,
} = internApi;
