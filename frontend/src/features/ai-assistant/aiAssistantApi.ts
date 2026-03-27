import { api } from '../../app/api';

export const aiAssistantApi = api.injectEndpoints({
  endpoints: (builder) => ({
    aiChat: builder.mutation<any, { message: string; context: string }>({
      query: (body) => ({ url: '/ai-assistant/chat', method: 'POST', body }),
    }),
    aiClearHistory: builder.mutation<any, { context: string }>({
      query: (body) => ({ url: '/ai-assistant/clear', method: 'POST', body }),
    }),
  }),
});

export const { useAiChatMutation, useAiClearHistoryMutation } = aiAssistantApi;
