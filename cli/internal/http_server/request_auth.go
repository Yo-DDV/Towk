package http_server

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/authctx"
	"hmans.de/chatto/internal/core"
)

type authenticationValidationErrorKey struct{}

var errAuthenticationServiceUnavailable = errors.New("authentication service temporarily unavailable")

func authenticationValidationError(ctx context.Context) error {
	err, _ := ctx.Value(authenticationValidationErrorKey{}).(error)
	return err
}

func writeAuthenticationUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Authentication service temporarily unavailable"})
}

// injectUserIntoContext extracts the authenticated user from either a bearer token
// or the runtime credential handle in the Gin session cookie, and returns an updated http.Request with the user
// injected into its context.
// Returns the original request if no user is authenticated (allowing unauthenticated requests).
func (s *HTTPServer) injectUserIntoContext(c *gin.Context) *http.Request {
	credential, ok, err := s.presentedCredentialFromRequest(c)
	if err != nil {
		ctx := context.WithValue(c.Request.Context(), authenticationValidationErrorKey{}, err)
		return c.Request.WithContext(ctx)
	}
	if !ok {
		return c.Request
	}

	ctx := authctx.WithUser(c.Request.Context(), credential.user)
	ctx = authctx.WithCredential(ctx, credential.auth)

	if credential.auth.Kind == authctx.RuntimeCredentialKindCookieSession {
		s.rotateCookieSessionIfNeeded(c, credential.auth.UserID, credential.auth.Handle, credential.cookieRecord)
	}

	return c.Request.WithContext(ctx)
}

func (s *HTTPServer) presentedCredentialFromRequest(c *gin.Context) (presentedRuntimeCredential, bool, error) {
	authHeaders, authorizationPresent := c.Request.Header[http.CanonicalHeaderKey("Authorization")]
	if authorizationPresent {
		if len(authHeaders) != 1 {
			return presentedRuntimeCredential{}, false, nil
		}
		parts := strings.Fields(authHeaders[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return presentedRuntimeCredential{}, false, nil
		}
		// An explicitly presented credential is authoritative. Invalid bearer
		// credentials must not silently inherit an ambient browser cookie.
		return s.bearerPresentedCredential(c.Request.Context(), parts[1])
	}

	return s.cookiePresentedCredential(c)
}

func (s *HTTPServer) bearerPresentedCredential(ctx context.Context, token string) (presentedRuntimeCredential, bool, error) {
	credential, err := s.core.ValidatePresentedRuntimeCredential(ctx, token, core.AuthTokenPresentationBearer)
	if err != nil {
		if errors.Is(err, core.ErrAuthTokenNotFound) {
			return presentedRuntimeCredential{}, false, nil
		}
		return presentedRuntimeCredential{}, false, err
	}
	user, err := s.core.GetUser(ctx, credential.UserID)
	if err != nil {
		log.Warn("Bearer runtime credential valid but user not found", "userId", credential.UserID, "error", err)
		return presentedRuntimeCredential{}, false, nil
	}
	return presentedRuntimeCredential{
		user: user,
		auth: authctx.RuntimeCredential{
			Kind:   authctx.RuntimeCredentialKindBearerToken,
			UserID: credential.UserID,
			Handle: token,
		},
	}, true, nil
}
