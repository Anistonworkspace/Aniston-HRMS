import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'),
  deviceId: z.string().max(255).optional(),
  deviceType: z.enum(['mobile', 'desktop']).optional(),
  userAgent: z.string().max(500).optional(),
  forceLogin: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
});

export const mfaCodeSchema = z.object({
  code: z.string().min(6, 'Code is required').max(9, 'Code too long'),
});

export const mfaVerifySchema = z.object({
  tempToken: z.string().min(1, 'Session token is required'),
  token: z.string().min(6, 'Code is required').max(9, 'Code too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export const adminResetPasswordSchema = z.object({
  targetUserId: z.string().uuid('Invalid user ID'),
});

export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
