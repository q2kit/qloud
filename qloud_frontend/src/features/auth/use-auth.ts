import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  fetchProviders,
  fetchSession,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup,
  verifyEmail,
  type AuthProvider,
  type AuthSession,
  type LoginInput,
  type SignupInput,
} from './api';

export const sessionQueryKey = ['auth', 'session'] as const;

export function useSession(): UseQueryResult<AuthSession> {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    staleTime: 60_000,
  });
}

export function useAuthProviders(): UseQueryResult<AuthProvider[]> {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: fetchProviders,
    staleTime: Infinity,
  });
}

/** Store the session a mutation returned, so guards react without refetching. */
export function useSetSession(): (session: AuthSession) => void {
  const queryClient = useQueryClient();
  return (session) => {
    queryClient.setQueryData(sessionQueryKey, session);
  };
}

export function useLogin(): UseMutationResult<AuthSession, Error, LoginInput> {
  const setSession = useSetSession();
  return useMutation({ mutationFn: login, onSuccess: setSession });
}

/**
 * Signing up also signs in. The session is not stored here so the page can
 * first say a verification email was sent; it stores it when the user goes on.
 */
export function useSignup(): UseMutationResult<
  AuthSession,
  Error,
  SignupInput
> {
  return useMutation({ mutationFn: signup });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Drop every cached response of the previous user.
      queryClient.clear();
      queryClient.setQueryData(sessionQueryKey, {
        user: null,
        flows: [],
      } satisfies AuthSession);
    },
  });
}

export function useVerifyEmail(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verifyEmail,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
  });
}

export function useRequestPasswordReset(): UseMutationResult<
  void,
  Error,
  { email: string; turnstileToken: string }
> {
  return useMutation({
    mutationFn: ({ email, turnstileToken }) =>
      requestPasswordReset(email, turnstileToken),
  });
}

export function useResetPassword(): UseMutationResult<
  void,
  Error,
  { key: string; password: string }
> {
  return useMutation({
    mutationFn: ({ key, password }) => resetPassword(key, password),
  });
}
