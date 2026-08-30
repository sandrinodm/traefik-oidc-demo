package traefik_oidc_provider_selector

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultTemplateFile = "/plugins-local/src/github.com/sandrinodm/traefik-oidc-provider-selector/page.html"

// Provider is an OIDC middleware choice exposed on the selector page.
type Provider struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

// Config configures the provider selector middleware.
type Config struct {
	CookieMaxAge          int        `json:"cookieMaxAge,omitempty"`
	CookieName            string     `json:"cookieName,omitempty"`
	CookieSecure          bool       `json:"cookieSecure,omitempty"`
	Providers             []Provider `json:"providers,omitempty"`
	SessionCookiePrefixes []string   `json:"sessionCookiePrefixes,omitempty"`
	TemplateFile          string     `json:"templateFile,omitempty"`
}

// CreateConfig returns safe defaults for a local Traefik plugin instance.
func CreateConfig() *Config {
	return &Config{
		CookieMaxAge: 8 * 60 * 60,
		CookieName:   "oidc_provider",
		CookieSecure: true,
		SessionCookiePrefixes: []string{
			"TraefikOidcAuth.Provider1.",
			"TraefikOidcAuth.Provider2.",
		},
		TemplateFile: defaultTemplateFile,
	}
}

type selector struct {
	config    Config
	styles    template.CSS
	templates *template.Template
}

type providerView struct {
	Action string
	ID     string
	Name   string
}

type pageData struct {
	Description string
	Mode        string
	Providers   []providerView
	ReturnTo    string
	Styles      template.CSS
	Title       string
}

// New constructs the Traefik middleware. It intentionally does not retain the
// downstream handler: every request routed here must be answered fail-closed.
func New(_ context.Context, _ http.Handler, config *Config, name string) (http.Handler, error) {
	if config == nil {
		return nil, fmt.Errorf("%s: config is required", name)
	}
	if err := validateConfig(*config); err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}

	templates, err := template.ParseFiles(config.TemplateFile)
	if err != nil {
		return nil, fmt.Errorf("%s: parse template: %w", name, err)
	}
	styles, err := os.ReadFile(filepath.Join(filepath.Dir(config.TemplateFile), "styles.css"))
	if err != nil {
		return nil, fmt.Errorf("%s: read stylesheet: %w", name, err)
	}

	return &selector{config: *config, styles: template.CSS(styles), templates: templates}, nil
}

func validateConfig(config Config) error {
	if !validToken(config.CookieName) {
		return fmt.Errorf("cookieName must contain only letters, digits, dots, underscores, or hyphens")
	}
	if config.CookieMaxAge <= 0 {
		return fmt.Errorf("cookieMaxAge must be greater than zero")
	}
	if strings.TrimSpace(config.TemplateFile) == "" {
		return fmt.Errorf("templateFile is required")
	}

	seen := make(map[string]struct{}, len(config.Providers))
	for _, provider := range config.Providers {
		if !validToken(provider.ID) {
			return fmt.Errorf("provider id %q must contain only letters, digits, dots, underscores, or hyphens", provider.ID)
		}
		if strings.TrimSpace(provider.Name) == "" {
			return fmt.Errorf("provider %q must have a name", provider.ID)
		}
		if _, exists := seen[provider.ID]; exists {
			return fmt.Errorf("provider id %q is duplicated", provider.ID)
		}
		seen[provider.ID] = struct{}{}
	}

	for _, prefix := range config.SessionCookiePrefixes {
		if strings.TrimSpace(prefix) == "" {
			return fmt.Errorf("session cookie prefixes cannot be empty")
		}
	}
	return nil
}

func validToken(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '.' || character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func (selector *selector) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	setSecurityHeaders(w)

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/healthz":
		selector.health(w)
	case request.Method == http.MethodGet && request.URL.Path == "/login":
		selector.chooseOrRedirect(w, request, safeReturnTo(request.URL.Query().Get("return_to")))
	case request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/login/"):
		selector.selectProvider(w, request)
	case request.Method == http.MethodGet && request.URL.Path == "/logout":
		selector.logout(w, request)
	case request.Method == http.MethodGet && request.URL.Path == "/signed-out":
		selector.signedOut(w)
	case request.Method == http.MethodGet || request.Method == http.MethodHead:
		selector.chooseOrRedirect(w, request, safeReturnTo(request.URL.RequestURI()))
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
}

func (selector *selector) health(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	response := struct {
		Providers int    `json:"providers"`
		Status    string `json:"status"`
	}{Providers: len(selector.config.Providers), Status: "ok"}
	_ = json.NewEncoder(w).Encode(response)
}

func (selector *selector) chooseOrRedirect(w http.ResponseWriter, request *http.Request, returnTo string) {
	switch len(selector.config.Providers) {
	case 0:
		selector.render(w, http.StatusServiceUnavailable, pageData{
			Description: "No identity providers are configured.",
			Mode:        "unavailable",
			Title:       "Sign-in unavailable",
		})
	case 1:
		selector.setProviderCookie(w, selector.config.Providers[0].ID)
		http.Redirect(w, request, returnTo, http.StatusFound)
	default:
		providers := make([]providerView, 0, len(selector.config.Providers))
		for _, item := range selector.config.Providers {
			providers = append(providers, providerView{
				Action: "/login/" + item.ID,
				ID:     item.ID,
				Name:   item.Name,
			})
		}
		selector.render(w, http.StatusOK, pageData{
			Description: "Choose an identity provider to continue.",
			Mode:        "chooser",
			Providers:   providers,
			ReturnTo:    returnTo,
			Title:       "Sign in",
		})
	}
}

func (selector *selector) selectProvider(w http.ResponseWriter, request *http.Request) {
	if crossOriginProviderSelection(request) {
		http.Error(w, "cross-origin provider selection is not allowed", http.StatusForbidden)
		return
	}

	request.Body = http.MaxBytesReader(w, request.Body, 8<<10)
	if err := request.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}

	selected := strings.TrimPrefix(request.URL.Path, "/login/")
	if strings.Contains(selected, "/") || !selector.providerEnabled(selected) {
		http.Error(w, "unknown or disabled identity provider", http.StatusNotFound)
		return
	}

	selector.setProviderCookie(w, selected)
	http.Redirect(w, request, safeReturnTo(request.FormValue("return_to")), http.StatusSeeOther)
}

func crossOriginProviderSelection(request *http.Request) bool {
	switch strings.ToLower(strings.TrimSpace(request.Header.Get("Sec-Fetch-Site"))) {
	case "same-origin":
		return false
	case "same-site", "cross-site":
		return true
	}

	origin := request.Header.Get("Origin")
	return origin != "" && origin != externalOrigin(request)
}

func (selector *selector) logout(w http.ResponseWriter, request *http.Request) {
	names := map[string]struct{}{selector.config.CookieName: {}}
	for _, cookie := range request.Cookies() {
		for _, prefix := range selector.config.SessionCookiePrefixes {
			if strings.HasPrefix(cookie.Name, prefix) {
				names[cookie.Name] = struct{}{}
			}
		}
	}

	for name := range names {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(1, 0).UTC(),
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   selector.config.CookieSecure,
			SameSite: http.SameSiteLaxMode,
		})
	}

	http.Redirect(w, request, "/signed-out", http.StatusSeeOther)
}

func (selector *selector) signedOut(w http.ResponseWriter) {
	selector.render(w, http.StatusOK, pageData{
		Description: "Your local gateway session has been cleared.",
		Mode:        "signed-out",
		Title:       "Signed out",
	})
}

func (selector *selector) render(w http.ResponseWriter, status int, data pageData) {
	data.Styles = selector.styles
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := selector.templates.ExecuteTemplate(w, "page", data); err != nil {
		log.Printf("render provider selector template: %v", err)
	}
}

func (selector *selector) providerEnabled(id string) bool {
	for _, item := range selector.config.Providers {
		if item.ID == id {
			return true
		}
	}
	return false
}

func (selector *selector) setProviderCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     selector.config.CookieName,
		Value:    id,
		Path:     "/",
		Expires:  time.Now().Add(time.Duration(selector.config.CookieMaxAge) * time.Second),
		MaxAge:   selector.config.CookieMaxAge,
		HttpOnly: true,
		Secure:   selector.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func safeReturnTo(value string) string {
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || hasUnsafeCharacter(value) {
		return "/"
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(parsed.Path, "//") || hasUnsafeCharacter(parsed.Path) {
		return "/"
	}

	path := parsed.Path
	if path == "/login" || strings.HasPrefix(path, "/login/") || path == "/logout" || path == "/signed-out" || path == "/healthz" {
		return "/"
	}
	return value
}

func hasUnsafeCharacter(value string) bool {
	for _, character := range value {
		if character == '\\' || character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func externalOrigin(request *http.Request) string {
	protocol := firstHeaderValue(request.Header.Get("X-Forwarded-Proto"))
	if protocol == "" {
		protocol = "http"
	}
	host := firstHeaderValue(request.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = request.Host
	}
	return protocol + "://" + host
}

func firstHeaderValue(value string) string {
	if before, _, found := strings.Cut(value, ","); found {
		return strings.TrimSpace(before)
	}
	return strings.TrimSpace(value)
}
