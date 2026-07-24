package connectapi

import (
	"context"
	"net/url"
	"strings"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/externalgif"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
	discoveryv1 "hmans.de/chatto/internal/pb/chatto/discovery/v1"
)

type serverDiscoveryService struct {
	api *API
}

type serverProfileOptions struct {
	tolerateErrors bool
}

const (
	serverCapabilityMessageCreateIdempotency = "message.create-idempotency-v1"
	serverCapabilityExternalGIFEmbeds        = "external-gif-embeds-v1"
)

func (s *serverDiscoveryService) GetServer(ctx context.Context, _ *connect.Request[discoveryv1.GetServerRequest]) (*connect.Response[discoveryv1.GetServerResponse], error) {
	profile, err := s.api.serverProfile(ctx, serverProfileOptions{tolerateErrors: true})
	if err != nil {
		return nil, err
	}
	response := &discoveryv1.GetServerResponse{
		Profile: profile,
		Login: &apiv1.ServerLogin{
			DirectRegistrationEnabled: s.api.config.Auth.DirectRegistrationOrDefault(),
			Providers:                 apiAuthProviders(s.api.config.Auth.PublicProviders()),
			AuthorizeUrl:              "/oauth/authorize",
		},
	}
	return connect.NewResponse(response), nil
}

func serverCapabilities(coreReady, externalGIFEnabled bool) []string {
	capabilities := []string{serverCapabilityMessageCreateIdempotency}
	if coreReady && externalGIFEnabled {
		capabilities = append(capabilities, serverCapabilityExternalGIFEmbeds)
	}
	return capabilities
}

func (a *API) effectiveServerName(ctx context.Context) string {
	if a.core != nil && a.core.ConfigManager() != nil {
		if n, err := a.core.ConfigManager().GetEffectiveServerName(ctx); err == nil {
			return n
		}
	}
	return "Towk"
}

func (a *API) serverProfile(ctx context.Context, options serverProfileOptions) (*apiv1.ServerPublicProfile, error) {
	capabilities := serverCapabilities(a.core != nil, externalgif.Enabled())
	profile := &apiv1.ServerPublicProfile{
		Name:         a.effectiveServerName(ctx),
		Version:      a.version,
		Capabilities: capabilities,
	}

	if a.core != nil && a.core.ConfigManager() != nil {
		cm := a.core.ConfigManager()
		if welcome, err := cm.GetEffectiveWelcomeMessage(ctx); err != nil {
			if !options.tolerateErrors {
				return nil, connectError(err)
			}
		} else if welcome != "" {
			profile.WelcomeMessage = stringPtr(welcome)
		}
		if cfg, err := cm.GetServerConfig(ctx); err != nil {
			if !options.tolerateErrors {
				return nil, connectError(err)
			}
		} else if cfg != nil && cfg.GetDescription() != "" {
			profile.Description = stringPtr(cfg.GetDescription())
		}
	}

	if a.core != nil {
		bw, bh := 1200, 630
		if u, err := a.core.GetServerBannerURL(ctx, &bw, &bh, "cover"); err != nil {
			if !options.tolerateErrors {
				return nil, connectError(err)
			}
		} else if u != "" {
			profile.BannerUrl = stringPtr(a.absolutizeAssetURL(ctx, u))
		}
		lw, lh := 256, 256
		if u, err := a.core.GetServerLogoURL(ctx, &lw, &lh, "cover"); err != nil {
			if !options.tolerateErrors {
				return nil, connectError(err)
			}
		} else if u != "" {
			profile.LogoUrl = stringPtr(a.absolutizeAssetURL(ctx, u))
		}
	}

	return profile, nil
}

func apiAuthProviders(providers []config.AuthProviderConfig) []*apiv1.ProviderMetadata {
	result := make([]*apiv1.ProviderMetadata, 0, len(providers))
	for _, provider := range providers {
		result = append(result, apiProviderMetadata(provider))
	}
	return result
}

func apiProviderMetadata(provider config.AuthProviderConfig) *apiv1.ProviderMetadata {
	return &apiv1.ProviderMetadata{
		Id:       provider.ID,
		Type:     provider.Type,
		Label:    provider.LabelOrDefault(),
		LoginUrl: "/auth/providers/" + url.PathEscape(provider.ID),
	}
}

func (a *API) absolutizeAssetURL(ctx context.Context, assetURL string) string {
	if assetURL == "" || strings.HasPrefix(assetURL, "http://") || strings.HasPrefix(assetURL, "https://") {
		return assetURL
	}
	if a.config.Webserver.URL != "" {
		base, err := url.Parse(a.config.Webserver.URL)
		if err == nil && base.Scheme != "" && base.Host != "" {
			return base.Scheme + "://" + base.Host + assetURL
		}
	}
	if requestBaseURL := requestBaseURLFromContext(ctx); requestBaseURL != "" {
		return requestBaseURL + assetURL
	}
	return assetURL
}
