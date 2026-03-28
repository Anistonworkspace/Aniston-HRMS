import { api } from '../../app/api';

export const aiAssistantApi = api.injectEndpoints({
  endpoints: (builder) => ({
    aiChat: builder.mutation<any, { message: string; context: string }>({
      query: (body) => ({ url: '/ai-assistant/chat', method: 'POST', body }),
    }),
    aiClearHistory: builder.mutation<any, { context: string }>({
      query: (body) => ({ url: '/ai-assistant/clear', method: 'POST', body }),
    }),
    getAiHistory: builder.query<any, { context: string }>({
      query: ({ context }) => `/ai-assistant/history?context=${context}`,
    }),
    getKnowledgeBase: builder.query<any, void>({
      query: () => '/ai-assistant/knowledge',
      providesTags: ['KnowledgeBase'],
    }),
    addKnowledgeDoc: builder.mutation<any, { title: string; content: string }>({
      query: (body) => ({ url: '/ai-assistant/train', method: 'POST', body }),
      invalidatesTags: ['KnowledgeBase'],
    }),
    deleteKnowledgeDoc: builder.mutation<any, string>({
      query: (id) => ({ url: `/ai-assistant/knowledge/${id}`, method: 'DELETE' }),
      invalidatesTags: ['KnowledgeBase'],
    }),
  }),
});

export const {
  useAiChatMutation,
  useAiClearHistoryMutation,
  useGetAiHistoryQuery,
  useGetKnowledgeBaseQuery,
  useAddKnowledgeDocMutation,
  useDeleteKnowledgeDocMutation,
} = aiAssistantApi;
