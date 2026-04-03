import { api } from '../../app/api';

export const salaryTemplateApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSalaryTemplates: builder.query<any, { type?: string } | void>({
      query: (params) => ({
        url: '/salary-templates',
        params: params || undefined,
      }),
      providesTags: ['SalaryTemplate'],
    }),

    getSalaryTemplate: builder.query<any, string>({
      query: (id) => `/salary-templates/${id}`,
      providesTags: ['SalaryTemplate'],
    }),

    createSalaryTemplate: builder.mutation<any, any>({
      query: (body) => ({ url: '/salary-templates', method: 'POST', body }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    updateSalaryTemplate: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/salary-templates/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    deleteSalaryTemplate: builder.mutation<any, string>({
      query: (id) => ({ url: `/salary-templates/${id}`, method: 'DELETE' }),
      invalidatesTags: ['SalaryTemplate'],
    }),

    applyTemplate: builder.mutation<any, {
      templateId: string;
      employeeIds: string[];
      effectiveFrom: string;
      reason: string;
      overrides?: Record<string, number>;
      confirmOverwrite?: boolean;
    }>({
      query: (body) => ({ url: '/salary-templates/apply', method: 'POST', body }),
      invalidatesTags: ['SalaryTemplate', 'Payroll'],
    }),

    saveAsTemplate: builder.mutation<any, {
      employeeId: string;
      name: string;
      type: string;
      description?: string;
      lockedFields?: string[];
    }>({
      query: (body) => ({ url: '/salary-templates/save-from-employee', method: 'POST', body }),
      invalidatesTags: ['SalaryTemplate'],
    }),
  }),
});

export const {
  useGetSalaryTemplatesQuery,
  useGetSalaryTemplateQuery,
  useCreateSalaryTemplateMutation,
  useUpdateSalaryTemplateMutation,
  useDeleteSalaryTemplateMutation,
  useApplyTemplateMutation,
  useSaveAsTemplateMutation,
} = salaryTemplateApi;
