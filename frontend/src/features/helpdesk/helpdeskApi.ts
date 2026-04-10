import { api } from '../../app/api';

export const helpdeskApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyTickets: builder.query<any, void>({
      query: () => '/helpdesk/my',
      providesTags: ['Helpdesk'],
    }),
    getAllTickets: builder.query<any, { page?: number; limit?: number; status?: string }>({
      query: (params) => ({ url: '/helpdesk/all', params }),
      providesTags: ['Helpdesk'],
    }),
    createTicket: builder.mutation<any, any>({
      query: (body) => ({ url: '/helpdesk', method: 'POST', body }),
      invalidatesTags: ['Helpdesk'],
    }),
    getTicketDetail: builder.query<any, string>({
      query: (id) => `/helpdesk/${id}`,
      providesTags: (result, error, id) => [{ type: 'Helpdesk', id }],
    }),
    updateTicket: builder.mutation<any, { id: string; data: any }>({
      query: ({ id, data }) => ({ url: `/helpdesk/${id}`, method: 'PATCH', body: data }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Helpdesk', id }, 'Helpdesk'],
    }),
    addComment: builder.mutation<any, { id: string; content: string; isInternal?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/helpdesk/${id}/comment`, method: 'POST', body }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Helpdesk', id }, 'Helpdesk'],
    }),
  }),
});

export const {
  useGetMyTicketsQuery,
  useGetAllTicketsQuery,
  useCreateTicketMutation,
  useGetTicketDetailQuery,
  useUpdateTicketMutation,
  useAddCommentMutation,
} = helpdeskApi;
