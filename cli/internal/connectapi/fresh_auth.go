package connectapi

import (
	"context"

	"hmans.de/chatto/internal/authctx"
	"hmans.de/chatto/internal/core"
)

func (a *API) requireFreshCredential(ctx context.Context, caller Caller, currentPassword string) error {
	credential, ok := authctx.CredentialForContext(ctx)
	if !ok || credential.UserID != caller.UserID {
		return core.ErrFreshAuthRequired
	}

	if currentPassword != "" {
		if err := a.core.VerifyUserPassword(ctx, caller.UserID, currentPassword); err != nil {
			return err
		}
		if err := a.markCredentialFresh(ctx, credential, "password", "current_password"); err != nil {
			return err
		}
		return nil
	}

	return a.requireCredentialFresh(ctx, credential)
}

func (a *API) requireCredentialFresh(ctx context.Context, credential authctx.RuntimeCredential) error {
	switch credential.Kind {
	case authctx.RuntimeCredentialKindBearerToken:
		return a.core.RequireFreshAuthForBearerToken(ctx, credential.Handle)
	case authctx.RuntimeCredentialKindCookieSession:
		return a.core.RequireFreshAuthForCookieSession(ctx, credential.UserID, credential.Handle)
	default:
		return core.ErrFreshAuthRequired
	}
}

func (a *API) markCredentialFresh(ctx context.Context, credential authctx.RuntimeCredential, method, source string) error {
	switch credential.Kind {
	case authctx.RuntimeCredentialKindBearerToken:
		return a.core.MarkBearerTokenFresh(ctx, credential.Handle, method, source)
	case authctx.RuntimeCredentialKindCookieSession:
		return a.core.MarkCookieSessionFresh(ctx, credential.UserID, credential.Handle, method, source)
	default:
		return core.ErrFreshAuthRequired
	}
}
