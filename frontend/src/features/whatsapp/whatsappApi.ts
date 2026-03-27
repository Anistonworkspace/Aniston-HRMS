import { api } from '../../app/api';

export const whatsappApi = api.injectEndpoints({
  endpoints: (builder) => ({
    initializeWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/initialize', method: 'POST' }),
      invalidatesTags: ['WhatsApp'],
    }),
    getWhatsAppStatus: builder.query<any, void>({
      query: () => '/whatsapp/status',
      providesTags: ['WhatsApp'],
    }),
    getWhatsAppQr: builder.query<any, void>({
      query: () => '/whatsapp/qr',
      providesTags: ['WhatsApp'],
    }),
    sendWhatsAppMessage: builder.mutation<any, { to: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
      invalidatesTags: ['WhatsApp'],
    }),
    sendWhatsAppJobLink: builder.mutation<any, { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }>({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
      invalidatesTags: ['WhatsApp'],
    }),
    getWhatsAppMessages: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/whatsapp/messages', params }),
      providesTags: ['WhatsApp'],
    }),
    logoutWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/logout', method: 'POST' }),
      invalidatesTags: ['WhatsApp'],
    }),
    // Chat endpoints for WhatsApp Web UI
    getWhatsAppChats: builder.query<any, void>({
      query: () => '/whatsapp/chats',
      providesTags: ['WhatsApp'],
    }),
    getWhatsAppChatMessages: builder.query<any, { chatId: string; limit?: number }>({
      query: ({ chatId, limit }) => ({ url: `/whatsapp/chats/${encodeURIComponent(chatId)}/messages`, params: { limit } }),
      providesTags: ['WhatsApp'],
    }),
    sendWhatsAppToNumber: builder.mutation<any, { phone: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send-to-number', method: 'POST', body }),
      invalidatesTags: ['WhatsApp'],
    }),
    getWhatsAppContacts: builder.query<any, void>({
      query: () => '/whatsapp/contacts',
      providesTags: ['WhatsApp'],
    }),
  }),
});

export const {
  useInitializeWhatsAppMutation,
  useGetWhatsAppStatusQuery,
  useGetWhatsAppQrQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppJobLinkMutation,
  useGetWhatsAppMessagesQuery,
  useLogoutWhatsAppMutation,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppChatMessagesQuery,
  useSendWhatsAppToNumberMutation,
  useGetWhatsAppContactsQuery,
} = whatsappApi;
