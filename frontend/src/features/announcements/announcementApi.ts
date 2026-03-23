import { api } from '../../app/api';

export const socialApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAnnouncements: builder.query<any, void>({ query: () => '/announcements' }),
    createAnnouncement: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements', method: 'POST', body }),
    }),
    getSocialPosts: builder.query<any, void>({ query: () => '/announcements/social' }),
    createPost: builder.mutation<any, any>({
      query: (body) => ({ url: '/announcements/social', method: 'POST', body }),
    }),
    likePost: builder.mutation<any, string>({
      query: (id) => ({ url: `/announcements/social/${id}/like`, method: 'POST' }),
    }),
    commentPost: builder.mutation<any, { id: string; content: string }>({
      query: ({ id, content }) => ({ url: `/announcements/social/${id}/comment`, method: 'POST', body: { content } }),
    }),
  }),
});

export const {
  useGetAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useGetSocialPostsQuery,
  useCreatePostMutation,
  useLikePostMutation,
  useCommentPostMutation,
} = socialApi;
