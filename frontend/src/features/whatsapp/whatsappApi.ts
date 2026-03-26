import { api } from '../../app/api';

export const whatsappApi = api.injectEndpoints({
  endpoints: (builder) => ({
    initializeWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/initialize', method: 'POST' }),
    }),
    getWhatsAppStatus: builder.query<any, void>({
      query: () => '/whatsapp/status',
    }),
    getWhatsAppQr: builder.query<any, void>({
      query: () => '/whatsapp/qr',
    }),
    sendWhatsAppMessage: builder.mutation<any, { to: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
    }),
    sendWhatsAppJobLink: builder.mutation<any, { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }>({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
    }),
    getWhatsAppMessages: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/whatsapp/messages', params }),
    }),
    logoutWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/logout', method: 'POST' }),
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
} = whatsappApi;
