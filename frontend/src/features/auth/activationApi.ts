import { api } from '../../app/api';

interface ValidationResult {
  valid: boolean;
  reason?: string;
  employeeId?: string;
  organizationName?: string;
}

interface ActivationResult {
  message: string;
  employeeId: string;
}

export const activationApi = api.injectEndpoints({
  endpoints: (builder) => ({
    validateActivation: builder.query<{ success: boolean; data: ValidationResult }, string>({
      query: (token) => `/auth/activate/${token}`,
    }),

    completeActivation: builder.mutation<{ success: boolean; data: ActivationResult; message: string }, string>({
      query: (token) => ({
        url: `/auth/activate/${token}/complete`,
        method: 'PATCH',
      }),
    }),
  }),
});

export const { useValidateActivationQuery, useCompleteActivationMutation } = activationApi;
