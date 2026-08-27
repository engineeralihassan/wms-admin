import type { User } from './user.model';

/** Request body for POST /auth/signIn. */
export interface SignInRequest {
  email: string;
  password: string;
}

/** A single JWT token with its expiry. */
export interface TokenPair {
  token: string;
  expires: string;
}

/** `data` payload of a successful sign-in: access token + user (refresh is a cookie). */
export interface SignInData {
  access: TokenPair;
  user: User;
}

/** `data` payload of POST /auth/refresh: { access } (refresh is a cookie). */
export interface RefreshData {
  access: TokenPair;
}

/** Request body for POST /auth/forgot-password. */
export interface ForgotPasswordRequest {
  email: string;
}

/** Request body for POST /auth/reset-password. */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}
