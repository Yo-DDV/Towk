package http_server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/authctx"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/email"
)

// Pre-compiled regexes for login validation
var (
	validLoginRegex   = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
	invalidCharsRegex = regexp.MustCompile(`[^a-z0-9._-]`)
)

func isStaleLoginCredentialError(err error) bool {
	return errors.Is(err, core.ErrCookieSessionNotFound) || errors.Is(err, core.ErrAuthTokenNotFound)
}

func (s *HTTPServer) authEmailServerName(ctx context.Context) string {
	if s.core != nil && s.core.ConfigManager() != nil {
		if name, err := s.core.ConfigManager().GetEffectiveServerName(ctx); err == nil && strings.TrimSpace(name) != "" {
			return name
		}
	}
	return "Towk"
}

func (s *HTTPServer) emailOTPExpirationText(locale string) string {
	ttl := s.config.Auth.EmailOTP.TTLOrDefault()
	switch {
	case ttl%time.Hour == 0:
		hours := int(ttl / time.Hour)
		return localizedDuration(locale, hours, "duration.hour.one", "duration.hour.other")
	case ttl%time.Minute == 0:
		minutes := int(ttl / time.Minute)
		return localizedDuration(locale, minutes, "duration.minute.one", "duration.minute.other")
	case ttl%time.Second == 0:
		seconds := int(ttl / time.Second)
		return localizedDuration(locale, seconds, "duration.second.one", "duration.second.other")
	default:
		return ttl.String()
	}
}

func (s *HTTPServer) setupAuthRoutes() {
	auth := s.router.Group("/auth")
	auth.Use(limitLegacyRequestBody())
	auth.Use(func(c *gin.Context) {
		s.requestContextWithAuditMetadata(c)
		c.Next()
	})

	auth.POST("logout", func(c *gin.Context) {
		ctx := c.Request.Context()

		loggedOutUserIDs := make(map[string]struct{}, 2)
		session := sessions.Default(c)
		cookieCredential, cookieOK, _ := s.cookiePresentedCredential(c)

		if authHeader := c.GetHeader("Authorization"); authHeader != "" {
			if token, ok := strings.CutPrefix(authHeader, "Bearer "); ok && strings.TrimSpace(token) != "" {
				userID, revoked, err := s.core.RevokePresentedRuntimeCredentialWithReason(ctx, strings.TrimSpace(token), core.AuthTokenPresentationBearer, "logout")
				if err != nil {
					log.Warn("Failed to revoke bearer runtime credential on logout", "error", err)
				}
				if revoked && userID != "" {
					loggedOutUserIDs[userID] = struct{}{}
				}
			}
		}

		if cookieOK {
			if err := s.core.RevokeCookieSession(ctx, cookieCredential.auth.UserID, cookieCredential.auth.Handle); err != nil {
				log.Warn("Failed to revoke cookie runtime credential on logout", "error", err)
			}
			if cookieCredential.auth.UserID != "" {
				loggedOutUserIDs[cookieCredential.auth.UserID] = struct{}{}
			}
		}

		// Clear the session cookie
		session.Clear()
		session.Save()
		s.clearCSRFCookie(c)

		// Publish session terminated events so other tabs/devices disconnect.
		for userID := range loggedOutUserIDs {
			if err := s.core.PublishSessionTerminated(ctx, userID, "logout"); err != nil {
				log.Warn("Failed to publish session terminated event", "error", err)
			}
			if err := s.core.RecordLogoutSucceeded(ctx, userID); err != nil {
				log.Warn("Failed to append logout audit event", "error", err, "userId", userID)
			}
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Revoke a specific bearer token
	auth.POST("revoke-token", func(c *gin.Context) {
		var req struct {
			Token string `json:"token" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.token_required")
			return
		}

		ctx := c.Request.Context()
		if err := s.core.RevokeAuthTokenWithReason(ctx, req.Token, "explicit"); err != nil {
			log.Error("Failed to revoke token", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.revoke_token_failed")
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Password login endpoint
	// Accepts login name (username) via "login" or "identifier" field
	auth.POST("login", func(c *gin.Context) {
		var loginRequest struct {
			Login      string `json:"login"`
			Identifier string `json:"identifier"` // Alternative field name used by frontend
			Password   string `json:"password" binding:"required"`
		}

		// Parse request body
		if err := c.ShouldBindJSON(&loginRequest); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.password_required")
			return
		}

		// Accept either "login" or "identifier" field
		login := loginRequest.Login
		if login == "" {
			login = loginRequest.Identifier
		}

		if login == "" {
			writeLocalizedError(c, http.StatusBadRequest, "auth.login_required")
			return
		}

		// Validate identifier length to prevent abuse
		// Email addresses can be up to 254 characters (RFC 5321), usernames up to 32
		maxLength := 32
		if strings.Contains(login, "@") {
			maxLength = 254
		}
		if len(login) > maxLength {
			writeLocalizedError(c, http.StatusBadRequest, "auth.invalid_credentials")
			return
		}

		// Verify credentials by login name
		ctx := c.Request.Context()
		retryAfter, err := s.core.ReserveAuthAttempt(ctx, core.AuthRateLimitLogin, login)
		if err != nil {
			if errors.Is(err, core.ErrAuthRateLimitExceeded) {
				setAuthRetryAfter(c, retryAfter)
				writeLocalizedError(c, http.StatusTooManyRequests, "auth.too_many_login_attempts")
				return
			}
			log.Error("Failed to reserve login rate limit", "error", err)
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.temporarily_unavailable")
			return
		}
		user, authGeneration, err := s.core.VerifyPasswordWithAuthGeneration(ctx, login, loginRequest.Password)
		if err != nil {
			if auditErr := s.core.RecordLoginFailed(ctx, login); auditErr != nil {
				log.Warn("Failed to append failed-login audit event", "error", auditErr)
			}
			log.Error("Login failed", "error", err)
			writeLocalizedError(c, http.StatusUnauthorized, "auth.invalid_credentials")
			return
		}

		// Create server-side cookie session
		if err := s.createCookieSessionForGeneration(c, user.Id, "password_login", authGeneration); err != nil {
			if isStaleLoginCredentialError(err) {
				if auditErr := s.core.RecordLoginFailed(ctx, login); auditErr != nil {
					log.Warn("Failed to append stale-login audit event", "error", auditErr)
				}
				log.Warn("Login became stale before session creation", "userId", user.Id)
				writeLocalizedError(c, http.StatusUnauthorized, "auth.invalid_credentials")
				return
			}
			log.Error("Failed to save session", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}
		if s.passwordLoginSessionCreatedHook != nil {
			s.passwordLoginSessionCreatedHook(c, user.Id, authGeneration)
		}

		session := sessions.Default(c)
		cookieCredential, _ := cookieCredentialFromSession(session)
		bearerToken := ""

		// Issue a bearer token (cross-origin clients use this instead of the session cookie).
		// If the password changed after VerifyPasswordWithAuthGeneration, the proven
		// generation is stale; undo the cookie session and fail the login cleanly.
		token, err := s.core.CreateAuthTokenWithSourceGeneration(ctx, user.Id, "password_login", authGeneration)
		if err != nil {
			if isStaleLoginCredentialError(err) {
				_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
				clearCookieSessionAuth(session)
				_ = session.Save()
				if auditErr := s.core.RecordLoginFailed(ctx, login); auditErr != nil {
					log.Warn("Failed to append stale-login audit event", "error", auditErr)
				}
				log.Warn("Login became stale before bearer token creation", "userId", user.Id)
				writeLocalizedError(c, http.StatusUnauthorized, "auth.invalid_credentials")
				return
			}
			log.Error("Failed to create auth token on login", "userId", user.Id, "error", err)
			_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
			clearCookieSessionAuth(session)
			_ = session.Save()
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		} else {
			bearerToken = token
		}

		if err := s.ensureCSRFToken(c); err != nil {
			log.Error("Failed to create CSRF token", "error", err)
			_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
			if bearerToken != "" {
				_ = s.core.RevokeAuthTokenWithReason(ctx, bearerToken, "login_csrf_failed")
			}
			session.Clear()
			_ = session.Save()
			s.clearCSRFCookie(c)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}

		if err := s.core.RecordLoginSucceeded(ctx, user.Id, login); err != nil {
			log.Error("Failed to append login audit event", "userId", user.Id, "error", err)
			_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
			if bearerToken != "" {
				_ = s.core.RevokeAuthTokenWithReason(ctx, bearerToken, "login_audit_failed")
			}
			session.Clear()
			_ = session.Save()
			s.clearCSRFCookie(c)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}

		log.Info("User logged in successfully", "userId", user.Id)
		if err := s.core.ClearAuthIdentifierLimit(ctx, core.AuthRateLimitLogin, login); err != nil {
			log.Warn("Failed to clear successful login rate limit", "error", err)
		}

		response := gin.H{
			"success": true,
			"user":    gin.H{"id": user.Id, "login": user.Login},
		}

		if bearerToken != "" {
			response["token"] = bearerToken
		}

		c.JSON(http.StatusOK, response)
	})

	// Email-first registration endpoint (step 1)
	// Accepts email only, creates a registration code, and sends it by email.
	// The user exchanges the code via POST /auth/register/verify-code, then
	// completes account creation via POST /auth/register/complete.
	auth.POST("register", func(c *gin.Context) {
		// Check if registration is enabled
		if !s.config.Auth.DirectRegistrationOrDefault() {
			writeLocalizedError(c, http.StatusForbidden, "auth.registration_disabled")
			return
		}

		var req struct {
			Email string `json:"email" binding:"required,email"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.valid_email_required")
			return
		}
		// Normalize at the HTTP boundary so downstream core code can treat email as canonical.
		req.Email = strings.ToLower(strings.TrimSpace(req.Email))

		// Require mailer — can't do email-first registration without email delivery
		if s.mailer == nil {
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.email_delivery_not_configured")
			return
		}

		ctx := c.Request.Context()

		// Check if email is already claimed — but always return 200 to prevent enumeration
		emailClaimed, err := s.core.IsEmailClaimed(ctx, req.Email)
		if err != nil {
			log.Error("Failed to check email availability", "error", err)
		}
		if emailClaimed {
			// Don't reveal that the email is taken — just return success
			log.Info("Registration attempt for already-claimed email")
			writeLocalizedMessage(c, http.StatusOK, "auth.registration_request_neutral")
			return
		}

		// Create registration code
		code, err := s.core.CreateRegistrationCode(ctx, req.Email)
		if err != nil {
			if errors.Is(err, core.ErrRegistrationCodeLimitExceeded) ||
				errors.Is(err, core.ErrRegistrationCodeExhausted) {
				log.Info("Registration code request throttled")
				writeLocalizedMessage(c, http.StatusOK, "auth.registration_request_neutral")
				return
			}
			log.Error("Failed to create registration code", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}

		// Send registration email
		serverName := s.authEmailServerName(ctx)
		locale := requestLocale(c)
		expirationText := s.emailOTPExpirationText(locale)
		err = s.mailer.Send(email.Message{
			To:      req.Email,
			Subject: localizedTextForLocale(locale, "email.registration_subject", serverName),
			Body:    localizedTextForLocale(locale, "email.registration_body", serverName, serverName, code, expirationText),
		})
		if err != nil {
			log.Error("Failed to send registration email", "error", err)
			if cancelErr := s.core.CancelRegistrationCode(ctx, req.Email, code); cancelErr != nil {
				log.Warn("Failed to cancel undelivered registration code", "error", cancelErr)
			}
			writeLocalizedError(c, http.StatusInternalServerError, "auth.email_send_failed")
			return
		}

		log.Info("Sent registration email")
		writeLocalizedMessage(c, http.StatusOK, "auth.registration_request_neutral")
	})

	// Registration code verification endpoint (step 2)
	// Validates the emailed six-digit code and returns a short-lived completion token.
	auth.POST("register/verify-code", func(c *gin.Context) {
		if !s.config.Auth.DirectRegistrationOrDefault() {
			writeLocalizedError(c, http.StatusForbidden, "auth.registration_disabled")
			return
		}

		var req struct {
			Email string `json:"email" binding:"required,email"`
			Code  string `json:"code" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.valid_email_code_required")
			return
		}
		req.Email = strings.ToLower(strings.TrimSpace(req.Email))

		token, err := s.core.VerifyRegistrationCode(c.Request.Context(), req.Email, req.Code)
		if err != nil {
			if errors.Is(err, core.ErrRegistrationCodeNotFound) ||
				errors.Is(err, core.ErrRegistrationCodeExpired) ||
				errors.Is(err, core.ErrRegistrationCodeInvalid) ||
				errors.Is(err, core.ErrRegistrationCodeExhausted) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.registration_code_invalid")
				return
			}
			log.Error("Failed to verify registration code", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}

		c.JSON(http.StatusOK, gin.H{"completionToken": token})
	})

	// Registration completion endpoint (step 2)
	// Validates the registration completion token, creates the user account,
	// verifies the email, and creates a session.
	auth.POST("register/complete", func(c *gin.Context) {
		// Check if registration is enabled
		if !s.config.Auth.DirectRegistrationOrDefault() {
			writeLocalizedError(c, http.StatusForbidden, "auth.registration_disabled")
			return
		}

		var req struct {
			Token                string `json:"token" binding:"required"`
			Login                string `json:"login" binding:"required"`
			Password             string `json:"password" binding:"required,min=8,max=128"`
			PasswordConfirmation string `json:"passwordConfirmation" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.registration_complete_required")
			return
		}

		ctx := c.Request.Context()

		// Validate token (not consumed on validation failure — user can retry)
		tokenData, err := s.core.GetRegistrationToken(ctx, req.Token)
		if err != nil {
			if errors.Is(err, core.ErrRegistrationTokenNotFound) || errors.Is(err, core.ErrRegistrationTokenExpired) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.registration_code_invalid")
				return
			}
			log.Error("Failed to validate registration completion token", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}

		// Validate login format
		if !isValidLogin(req.Login) {
			writeLocalizedError(c, http.StatusBadRequest, "auth.login_requirements")
			return
		}

		// Validate passwords match
		if req.Password != req.PasswordConfirmation {
			writeLocalizedError(c, http.StatusBadRequest, "auth.passwords_mismatch")
			return
		}

		// Check if login is blocked
		isBlocked, err := s.core.ConfigManager().IsUsernameBlocked(ctx, req.Login)
		if err != nil {
			log.Error("Failed to check blocked usernames", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}
		if isBlocked {
			writeLocalizedError(c, http.StatusBadRequest, "auth.username_unavailable")
			return
		}

		// Check if email was claimed while token was outstanding
		emailClaimed, err := s.core.IsEmailClaimed(ctx, tokenData.Email)
		if err != nil {
			log.Error("Failed to check email availability", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}
		if emailClaimed {
			writeLocalizedError(c, http.StatusConflict, "auth.email_in_use")
			return
		}

		// Create user with verified email atomically (use login as display name initially)
		user, err := s.core.CreateVerifiedUser(ctx, "system", req.Login, req.Login, req.Password, tokenData.Email)
		if err != nil {
			if errors.Is(err, core.ErrLoginAlreadyTaken) {
				writeLocalizedError(c, http.StatusConflict, "auth.username_taken")
				return
			}
			if errors.Is(err, core.ErrUsernameBlocked) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.username_unavailable")
				return
			}
			if errors.Is(err, core.ErrEmailAlreadyVerified) {
				writeLocalizedError(c, http.StatusConflict, "auth.email_in_use")
				return
			}
			if errors.Is(err, core.ErrLimitExceeded) {
				writeLocalizedError(c, http.StatusForbidden, "auth.instance_not_accepting")
				return
			}
			if errors.Is(err, core.ErrPasswordTooShort) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.password_too_short", core.MinPasswordLength)
				return
			}
			if errors.Is(err, core.ErrPasswordTooLong) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.password_too_long", core.MaxPasswordLength)
				return
			}
			log.Error("Registration failed", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.registration_failed")
			return
		}

		// Server membership is implicit; global rooms appear automatically.

		// Delete registration completion token (consumed)
		if err := s.core.DeleteRegistrationToken(ctx, req.Token); err != nil {
			log.Error("Failed to delete registration completion token", "error", err)
			// Don't fail — user was created successfully
		}

		// Create server-side cookie session
		if err := s.createCookieSession(c, user.Id, "registration_complete"); err != nil {
			log.Error("Failed to save session", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}
		session := sessions.Default(c)
		if err := s.ensureCSRFToken(c); err != nil {
			log.Error("Failed to create CSRF token", "error", err)
			cookieCredential, _ := cookieCredentialFromSession(session)
			_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
			session.Clear()
			_ = session.Save()
			s.clearCSRFCookie(c)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}

		log.Info("User registered and logged in", "userId", user.Id)

		response := gin.H{
			"success": true,
			"user":    gin.H{"id": user.Id, "login": user.Login},
		}

		token, err := s.core.CreateAuthTokenWithSource(ctx, user.Id, "registration")
		if err != nil {
			log.Error("Failed to create auth token on register", "userId", user.Id, "error", err)
			cookieCredential, _ := cookieCredentialFromSession(session)
			_ = s.core.RevokeCookieSession(ctx, user.Id, cookieCredential.sessionID)
			session.Clear()
			_ = session.Save()
			s.clearCSRFCookie(c)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.session_create_failed")
			return
		}
		response["token"] = token

		c.JSON(http.StatusOK, response)
	})

	// Authenticated email verification code request.
	auth.POST("verify-email/request-code", func(c *gin.Context) {
		req := s.injectUserIntoContext(c)
		if authenticationValidationError(req.Context()) != nil {
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.service_temporarily_unavailable")
			return
		}
		user := authctx.ForContext(req.Context())
		if user == nil {
			writeLocalizedError(c, http.StatusUnauthorized, "auth.authentication_required")
			return
		}
		if s.mailer == nil {
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.email_delivery_not_configured")
			return
		}

		var body struct {
			Email string `json:"email" binding:"required,email"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.valid_email_required")
			return
		}
		body.Email = strings.ToLower(strings.TrimSpace(body.Email))

		code, err := s.core.CreateEmailVerificationCode(req.Context(), user.Id, body.Email)
		if err != nil {
			if errors.Is(err, core.ErrEmailVerificationCodeLimitExceeded) ||
				errors.Is(err, core.ErrEmailVerificationCodeExhausted) {
				writeLocalizedError(c, http.StatusTooManyRequests, "auth.too_many_verification_requests")
				return
			}
			log.Error("Failed to create email verification code", "userId", user.Id, "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.verification_code_send_failed")
			return
		}
		serverName := s.authEmailServerName(req.Context())
		locale := requestLocale(c)
		expirationText := s.emailOTPExpirationText(locale)
		if err := s.mailer.Send(email.Message{
			To:      body.Email,
			Subject: localizedTextForLocale(locale, "email.verification_subject", serverName),
			Body:    localizedTextForLocale(locale, "email.verification_body", serverName, code, expirationText),
		}); err != nil {
			log.Error("Failed to send email verification code", "userId", user.Id, "error", err)
			if cancelErr := s.core.CancelEmailVerificationCode(req.Context(), user.Id, body.Email, code); cancelErr != nil {
				log.Warn("Failed to cancel undelivered email verification code", "userId", user.Id, "error", cancelErr)
			}
			writeLocalizedError(c, http.StatusInternalServerError, "auth.verification_code_send_failed")
			return
		}

		writeLocalizedMessage(c, http.StatusOK, "auth.verification_code_sent")
	})

	// Authenticated email verification code confirmation.
	auth.POST("verify-email/confirm-code", func(c *gin.Context) {
		req := s.injectUserIntoContext(c)
		if authenticationValidationError(req.Context()) != nil {
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.service_temporarily_unavailable")
			return
		}
		user := authctx.ForContext(req.Context())
		if user == nil {
			writeLocalizedError(c, http.StatusUnauthorized, "auth.authentication_required")
			return
		}

		var body struct {
			Email string `json:"email" binding:"required,email"`
			Code  string `json:"code" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.valid_email_code_required")
			return
		}
		body.Email = strings.ToLower(strings.TrimSpace(body.Email))

		if _, err := s.core.VerifyEmailCode(req.Context(), user.Id, body.Email, body.Code); err != nil {
			if errors.Is(err, core.ErrTokenNotFound) ||
				errors.Is(err, core.ErrTokenExpired) ||
				errors.Is(err, core.ErrEmailVerificationCodeInvalid) ||
				errors.Is(err, core.ErrEmailVerificationCodeExhausted) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.verification_code_invalid")
				return
			}
			if errors.Is(err, core.ErrEmailAlreadyVerified) {
				writeLocalizedError(c, http.StatusConflict, "auth.email_in_use")
				return
			}
			log.Error("Email verification failed", "userId", user.Id, "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.email_verification_failed")
			return
		}

		log.Info("Email verified successfully", "userId", user.Id)
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Forgot password endpoint - request a password reset email
	// Always returns 200 to prevent email enumeration
	auth.POST("forgot-password", func(c *gin.Context) {
		var req struct {
			Email string `json:"email" binding:"required,email"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.invalid_email_format")
			return
		}

		ctx := c.Request.Context()
		normalizedEmail := strings.ToLower(strings.TrimSpace(req.Email))
		retryAfter, reserveErr := s.core.ReserveAuthAttempt(ctx, core.AuthRateLimitForgotPassword, normalizedEmail)
		if reserveErr != nil {
			if errors.Is(reserveErr, core.ErrAuthRateLimitExceeded) {
				setAuthRetryAfter(c, retryAfter)
			} else {
				log.Error("Failed to reserve forgot-password rate limit", "error", reserveErr)
			}
			writeLocalizedMessage(c, http.StatusOK, "auth.reset_request_neutral")
			return
		}

		// Create token (returns empty string if email not found - no error)
		token, err := s.core.CreatePasswordResetToken(ctx, normalizedEmail)
		if err != nil {
			// Log error but don't expose to user
			log.Error("Failed to create password reset token", "error", err)
		}

		// Only send email if token was created (email exists and is verified)
		if token != "" && s.mailer != nil {
			serverName := s.authEmailServerName(ctx)
			locale := requestLocale(c)
			resetURL := fmt.Sprintf("%s/reset-password?token=%s", s.config.Webserver.URL, token)
			expirationText := localizedDuration(locale, 1, "duration.hour.one", "duration.hour.other")
			err = s.mailer.Send(email.Message{
				To:      normalizedEmail,
				Subject: localizedTextForLocale(locale, "email.reset_subject", serverName),
				Body:    localizedTextForLocale(locale, "email.reset_body", serverName, resetURL, expirationText),
			})
			if err != nil {
				log.Error("Failed to send password reset email", "error", err)
			} else {
				log.Info("Sent password reset email")
			}
		}

		// Always return success to prevent email enumeration
		writeLocalizedMessage(c, http.StatusOK, "auth.reset_request_neutral")
	})

	// Reset password endpoint - set a new password using a reset token
	auth.POST("reset-password", func(c *gin.Context) {
		var req struct {
			Token    string `json:"token" binding:"required"`
			Password string `json:"password" binding:"required,min=8,max=128"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			writeLocalizedError(c, http.StatusBadRequest, "auth.reset_required")
			return
		}

		// Defence in depth: validator's max=128 counts runes; core's check counts bytes.
		// Enforce the byte cap here so a multi-byte payload can't slip past binding.
		if err := core.ValidatePassword(req.Password); err != nil {
			if errors.Is(err, core.ErrPasswordTooShort) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.password_too_short", core.MinPasswordLength)
			} else {
				writeLocalizedError(c, http.StatusBadRequest, "auth.password_too_long", core.MaxPasswordLength)
			}
			return
		}

		ctx := c.Request.Context()
		retryAfter, err := s.core.ReserveAuthAttempt(ctx, core.AuthRateLimitResetPassword, req.Token)
		if err != nil {
			if errors.Is(err, core.ErrAuthRateLimitExceeded) {
				setAuthRetryAfter(c, retryAfter)
				writeLocalizedError(c, http.StatusTooManyRequests, "auth.too_many_reset_attempts")
				return
			}
			log.Error("Failed to reserve reset-password rate limit", "error", err)
			writeLocalizedError(c, http.StatusServiceUnavailable, "auth.reset_temporarily_unavailable")
			return
		}

		// Validate the token before paying the bcrypt cost, then atomically consume
		// it inside the existing reset transaction.
		err = s.core.ResetPasswordWithPassword(ctx, req.Token, req.Password)
		if err != nil {
			if errors.Is(err, core.ErrPasswordResetTokenNotFound) || errors.Is(err, core.ErrPasswordResetTokenExpired) {
				writeLocalizedError(c, http.StatusBadRequest, "auth.reset_link_invalid")
				return
			}
			log.Error("Failed to reset password", "error", err)
			writeLocalizedError(c, http.StatusInternalServerError, "auth.reset_failed")
			return
		}

		log.Info("Password reset successfully")
		writeLocalizedMessage(c, http.StatusOK, "auth.reset_success")
	})

	// Register test endpoints if built with -tags test_endpoints
	registerTestEndpoints(auth, s)
}

func setAuthRetryAfter(c *gin.Context, retryAfter time.Duration) {
	seconds := max(int64((retryAfter+time.Second-1)/time.Second), 1)
	c.Header("Retry-After", strconv.FormatInt(seconds, 10))
}

// isValidLogin validates that a login name meets the requirements:
// 2-32 characters, alphanumeric with dots, dashes, or underscores.
// Consecutive periods (..) are not allowed.
func isValidLogin(login string) bool {
	if len(login) < 2 || len(login) > 32 {
		return false
	}
	if strings.Contains(login, "..") {
		return false
	}
	return validLoginRegex.MatchString(login)
}

// deriveLoginFromEmail extracts a login name from an email address.
// Takes the part before @, converts to lowercase, and removes invalid characters.
// Valid characters: alphanumeric, underscore, dash, dot (2-32 chars).
func deriveLoginFromEmail(email string) string {
	// Extract part before @
	parts := strings.Split(email, "@")
	base := strings.ToLower(parts[0])

	// Remove invalid characters (keep only alphanumeric, underscore, dash, dot)
	base = invalidCharsRegex.ReplaceAllString(base, "")

	// Ensure minimum length
	if len(base) < 2 {
		base = "user"
	}

	// Truncate to max length
	if len(base) > 32 {
		base = base[:32]
	}

	return base
}

// isValidInternalRedirect checks if a redirect URL is safe (internal-only).
// Returns true for relative paths like "/chat" or "/settings/profile".
// Rejects absolute URLs, protocol-relative URLs (//evil.com), and other attack vectors.
func isValidInternalRedirect(redirect string) bool {
	// Must start with a single forward slash (relative path)
	if !strings.HasPrefix(redirect, "/") {
		return false
	}
	// Reject protocol-relative URLs (//evil.com) which browsers treat as absolute
	if strings.HasPrefix(redirect, "//") {
		return false
	}
	// Reject backslash variants that some browsers normalize to forward slashes
	if strings.Contains(redirect, "\\") {
		return false
	}
	return true
}
