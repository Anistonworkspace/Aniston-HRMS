import { api } from '../../app/api';

export const helpdeskApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyTickets: builder.query<any, void>({ query: () => '/helpdesk/my' }),
    createTicket: builder.mutation<any, any>({
      query: (body) => ({ url: '/helpdesk', method: 'POST', body }),
    }),
    getTicketDetail: builder.query<any, string>({ query: (id) => `/helpdesk/${id}` }),
    addComment: builder.mutation<any, { id: string; content: string }>({
      query: ({ id, content }) => ({ url: `/helpdesk/${id}/comment`, method: 'POST', body: { content } }),
    }),
  }),
});

export const {
  useGetMyTicketsQuery,
  useCreateTicketMutation,
  useGetTicketDetailQuery,
  useAddCommentMutation,
} = helpdeskApi;
