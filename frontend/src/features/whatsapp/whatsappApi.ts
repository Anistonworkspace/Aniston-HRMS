import { api } from '../../app/api';

export const whatsappApi = api.injectEndpoints({
  endpoints: (builder) => ({
    initializeWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/initialize', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus'],
    }),
    getWhatsAppStatus: builder.query<any, void>({
      query: () => '/whatsapp/status',
      providesTags: ['WhatsAppStatus'],
    }),
    getWhatsAppQr: builder.query<any, void>({
      query: () => '/whatsapp/qr',
      providesTags: ['WhatsAppStatus'],
    }),
    refreshWhatsAppQr: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/refresh-qr', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus'],
    }),
    logoutWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/logout', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus', 'WhatsAppChats'],
    }),

    // Chats — separate tag, not invalidated by send
    getWhatsAppChats: builder.query<any, void>({
      query: () => '/whatsapp/chats',
      providesTags: ['WhatsAppChats'],
      keepUnusedDataFor: 60,
    }),
    getWhatsAppContacts: builder.query<any, void>({
      query: () => '/whatsapp/contacts',
      providesTags: ['WhatsAppContacts'],
      keepUnusedDataFor: 300,
    }),

    // Messages for a specific chat — separate tag per chat
    getWhatsAppChatMessages: builder.query<any, { chatId: string; limit?: number }>({
      query: ({ chatId, limit }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/messages`,
        params: { limit },
      }),
      providesTags: (result, error, { chatId }) => [{ type: 'WhatsAppMessages' as const, id: chatId }],
    }),

    // HRMS DB messages
    getWhatsAppMessages: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/whatsapp/messages', params }),
      providesTags: ['WhatsAppHrmsMessages'],
    }),

    // Send mutations — only invalidate the chat list + HRMS messages, not contacts/status
    sendWhatsAppMessage: builder.mutation<any, { to: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppToNumber: builder.mutation<any, { phone: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send-to-number', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppJobLink: builder.mutation<any, { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }>({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
  }),
});

export const {
  useInitializeWhatsAppMutation,
  useGetWhatsAppStatusQuery,
  useGetWhatsAppQrQuery,
  useRefreshWhatsAppQrMutation,
  useLogoutWhatsAppMutation,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppContactsQuery,
  useGetWhatsAppChatMessagesQuery,
  useGetWhatsAppMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useSendWhatsAppJobLinkMutation,
} = whatsappApi;
