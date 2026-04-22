import { api } from '../../app/api';

export interface DbNotification {
  id: string;
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export const notificationsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getNotifications: builder.query<
      { data: DbNotification[]; meta: NotificationsMeta },
      { page?: number; limit?: number }
    >({
      query: ({ page = 1, limit = 20 } = {}) =>
        `/notifications?page=${page}&limit=${limit}`,
      transformResponse: (response: { data: DbNotification[]; meta: NotificationsMeta }) =>
        response,
      providesTags: ['Notification'],
    }),

    getUnreadCount: builder.query<{ count: number }, void>({
      query: () => '/notifications/unread-count',
      transformResponse: (response: { data: { count: number } }) => response.data,
      providesTags: ['NotificationUnread'],
    }),

    markNotificationRead: builder.mutation<DbNotification, string>({
      query: (id) => ({
        url: `/notifications/${id}/read`,
        method: 'PATCH',
      }),
      transformResponse: (response: { data: DbNotification }) => response.data,
      invalidatesTags: ['Notification', 'NotificationUnread'],
    }),

    markAllNotificationsRead: builder.mutation<{ updated: number }, void>({
      query: () => ({
        url: '/notifications/read-all',
        method: 'PATCH',
      }),
      transformResponse: (response: { data: { updated: number } }) => response.data,
      invalidatesTags: ['Notification', 'NotificationUnread'],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsApi;
