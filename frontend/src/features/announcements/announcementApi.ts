import { api } from '../../app/api';

export const socialApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAnnouncements: builder.query<any, void>({
      query: () => '/announcements',
      providesTags: ['Announcements'],
    }),
    createAnnouncement: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements', method: 'POST', body }),
      invalidatesTags: ['Announcements'],
    }),
    updateAnnouncement: builder.mutation<any, { id: string; body: any }>({
      query: ({ id, body }) => ({ url: `/announcements/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Announcements'],
    }),
    deleteAnnouncement: builder.mutation<any, string>({
      query: (id) => ({ url: `/announcements/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Announcements'],
    }),
    getSocialPosts: builder.query<any, void>({
      query: () => '/announcements/social',
      providesTags: ['SocialPosts'],
    }),
    createPost: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements/social', method: 'POST', body }),
      invalidatesTags: ['SocialPosts'],
    }),
    likePost: builder.mutation<any, string>({
      query: (id) => ({ url: `/announcements/social/${id}/like`, method: 'POST' }),
      invalidatesTags: ['SocialPosts'],
    }),
    commentPost: builder.mutation<any, { id: string; content: string }>({
      query: ({ id, content }) => ({ url: `/announcements/social/${id}/comment`, method: 'POST', body: { content } }),
      invalidatesTags: ['SocialPosts'],
    }),
    deleteSocialPost: builder.mutation<any, string>({
      query: (id) => ({ url: `/announcements/social/${id}`, method: 'DELETE' }),
      invalidatesTags: ['SocialPosts'],
    }),
  }),
});

export const {
  useGetAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useGetSocialPostsQuery,
  useCreatePostMutation,
  useLikePostMutation,
  useCommentPostMutation,
  useDeleteSocialPostMutation,
} = socialApi;
