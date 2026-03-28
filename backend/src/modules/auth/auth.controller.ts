import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { authService } from './auth.service.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from './auth.validation.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { decrypt } from '../../utils/encryption.js';
import { env } from '../../config/env.js';
import { buildAuthorizationUrl, exchangeCodeForTokens, getUserProfile } from '../../lib/microsoftGraph.js';
import { employeeService } from '../employee/employee.service.js';

const OAUTH_STATE_PREFIX = 'oauth_state:';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      const result = await authService.login(data.email, data.password);

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/auth',
      });

      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
        message: 'Login successful',
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
      if (!refreshToken) {
        res.status(401).json({
          success: false,
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'No refresh token provided' },
        });
        return;
      }

      const result = await authService.refreshAccessToken(refreshToken);

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      res.json({
        success: true,
        data: { accessToken: result.accessToken },
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies.refreshToken;
      await authService.logout(refreshToken);

      res.clearCookie('refreshToken', { path: '/api/auth' });
      res.json({ success: true, data: null, message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = forgotPasswordSchema.parse(req.body);
      const result = await authService.forgotPassword(data.email);
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(data.token, data.password);
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = changePasswordSchema.parse(req.body);
      const result = await authService.changePassword(
        req.user!.userId,
        data.currentPassword,
        data.newPassword
      );
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.getMe(req.user!.userId);
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async ssoStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const status = await authService.getSsoStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  }

  async microsoftLogin(_req: Request, res: Response, next: NextFunction) {
    try {
      const org = await prisma.organization.findFirst({ select: { settings: true } });
      const settings = (org?.settings as any) || {};
      const teams = settings.microsoftTeams;

      if (!teams?.tenantId || !teams?.clientId || !teams?.ssoEnabled) {
        res.status(400).json({ success: false, error: { message: 'Microsoft SSO is not configured' } });
        return;
      }

      const state = randomBytes(32).toString('hex');
      await redis.setex(`${OAUTH_STATE_PREFIX}${state}`, 600, 'valid'); // 10 min TTL

      const redirectUri = teams.redirectUri || `${env.API_URL}/api/auth/microsoft/callback`;
      const authUrl = buildAuthorizationUrl(teams.tenantId, teams.clientId, redirectUri, state);
      res.redirect(authUrl);
    } catch (err) {
      next(err);
    }
  }

  async microsoftCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, state, error: oauthError } = req.query as Record<string, string>;

      if (oauthError) {
        res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(oauthError)}`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Missing authorization code')}`);
        return;
      }

      // Validate state (CSRF protection)
      const storedState = await redis.get(`${OAUTH_STATE_PREFIX}${state}`);
      if (!storedState) {
        res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Invalid or expired state')}`);
        return;
      }
      await redis.del(`${OAUTH_STATE_PREFIX}${state}`);

      // Get Teams config
      const org = await prisma.organization.findFirst({ select: { settings: true } });
      const settings = (org?.settings as any) || {};
      const teams = settings.microsoftTeams;

      if (!teams?.clientSecret) {
        res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Teams configuration incomplete')}`);
        return;
      }

      const clientSecret = decrypt(teams.clientSecret);
      const redirectUri = teams.redirectUri || `${env.API_URL}/api/auth/microsoft/callback`;

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(teams.tenantId, teams.clientId, clientSecret, redirectUri, code);

      // Get user profile from Microsoft
      const profile = await getUserProfile(tokens.accessToken);
      const email = profile.mail || profile.userPrincipalName;

      // Login or link Microsoft account
      const result = await authService.loginWithMicrosoft(profile.id, email);

      // Set refresh token cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });

      // Redirect to frontend with access token
      const userData = encodeURIComponent(JSON.stringify(result.user));
      res.redirect(`${env.FRONTEND_URL}/auth/callback?accessToken=${result.accessToken}&user=${userData}`);
    } catch (err: any) {
      const message = err.message || 'SSO login failed';
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(message)}`);
    }
  }
  // Employee Activation
  async validateActivation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.validateActivationToken(req.params.token);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async completeActivation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeService.completeActivation(req.params.token);
      res.json({ success: true, data: result, message: result.message });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
