package traefik_oidc_provider_selector

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var twoProviders = []Provider{
	{ID: "provider-1", Name: "Google"},
	{ID: "provider-2", Name: "Auth0"},
}

func testSelector(t *testing.T, providers []Provider) http.Handler {
	t.Helper()
	config := CreateConfig()
	config.CookieSecure = false
	config.Providers = providers
	config.TemplateFile = "page.html"

	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("selector forwarded a request to the sink service")
	})
	handler, err := New(context.Background(), next, config, "test-selector")
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func TestSafeReturnTo(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"local":             "/reports?page=2#today",
		"protocol-relative": "//example.com/steal",
		"absolute":          "https://example.com/steal",
		"backslash":         "/\\example.com/steal",
		"encoded control":   "/%0d%0aLocation:%20https://example.com",
		"login loop":        "/login",
	}
	want := map[string]string{
		"local": "/reports?page=2#today",
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			expected := want[name]
			if expected == "" {
				expected = "/"
			}
			if got := safeReturnTo(input); got != expected {
				t.Fatalf("safeReturnTo(%q) = %q, want %q", input, got, expected)
			}
		})
	}
}

func TestMultipleProvidersRenderChooser(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/private?tab=one", nil)
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(body, "Continue with Google") || !strings.Contains(body, "Continue with Auth0") {
		t.Fatalf("unexpected chooser response: status=%d body=%q", response.Code, body)
	}
	if !strings.Contains(body, `value="/private?tab=one"`) {
		t.Fatalf("chooser did not preserve the return path: %q", body)
	}
	if response.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("selector omitted security headers: %#v", response.Header())
	}
}

func TestSingleProviderRedirectsWithoutChooser(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/private", nil)
	response := httptest.NewRecorder()

	testSelector(t, twoProviders[:1]).ServeHTTP(response, request)
	result := response.Result()
	if result.StatusCode != http.StatusFound || result.Header.Get("Location") != "/private" {
		t.Fatalf("unexpected redirect: status=%d location=%q", result.StatusCode, result.Header.Get("Location"))
	}
	cookies := result.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "oidc_provider" || cookies[0].Value != "provider-1" || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected provider cookie: %#v", cookies)
	}
}

func TestProviderSelection(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPost, "/login/provider-2", strings.NewReader("return_to=%2Fprivate"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "http://example.com")
	request.Host = "example.com"
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	result := response.Result()
	if result.StatusCode != http.StatusSeeOther || result.Header.Get("Location") != "/private" {
		t.Fatalf("unexpected selection response: status=%d location=%q", result.StatusCode, result.Header.Get("Location"))
	}
	if cookies := result.Cookies(); len(cookies) != 1 || cookies[0].Value != "provider-2" {
		t.Fatalf("unexpected provider cookie: %#v", cookies)
	}
}

func TestProviderSelectionAllowsBrowserSameOriginAcrossProxyScheme(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPost, "/login/provider-1", strings.NewReader("return_to=%2Fprivate"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Host = "example.com"
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	result := response.Result()
	if result.StatusCode != http.StatusSeeOther || result.Header.Get("Location") != "/private" {
		t.Fatalf("unexpected selection response: status=%d location=%q body=%q", result.StatusCode, result.Header.Get("Location"), response.Body.String())
	}
}

func TestProviderSelectionRejectsBrowserCrossSiteSignal(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPost, "/login/provider-1", strings.NewReader("return_to=%2F"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	request.Host = "example.com"
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || len(response.Result().Cookies()) != 0 {
		t.Fatalf("unexpected response: status=%d cookies=%#v", response.Code, response.Result().Cookies())
	}
}

func TestProviderSelectionRejectsCrossOrigin(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPost, "/login/provider-1", strings.NewReader("return_to=%2F"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://attacker.example")
	request.Host = "example.com"
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || len(response.Result().Cookies()) != 0 {
		t.Fatalf("unexpected response: status=%d cookies=%#v", response.Code, response.Result().Cookies())
	}
}

func TestLogoutClearsSelectorAndPluginCookies(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/logout", nil)
	request.Header.Set("Cookie", "oidc_provider=provider-1; TraefikOidcAuth.Provider1.Session.Chunks=2; TraefikOidcAuth.Provider1.Session.1=abc; unrelated=keep")
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	result := response.Result()
	if result.StatusCode != http.StatusSeeOther || result.Header.Get("Location") != "/signed-out" {
		t.Fatalf("unexpected logout: status=%d location=%q", result.StatusCode, result.Header.Get("Location"))
	}

	setCookies := strings.Join(result.Header.Values("Set-Cookie"), "\n")
	for _, name := range []string{"oidc_provider=", "TraefikOidcAuth.Provider1.Session.Chunks=", "TraefikOidcAuth.Provider1.Session.1="} {
		if !strings.Contains(setCookies, name) {
			t.Errorf("missing cleared cookie %q in %q", name, setCookies)
		}
	}
	if strings.Contains(setCookies, "unrelated=") {
		t.Fatalf("cleared unrelated cookie: %q", setCookies)
	}
}

func TestHealth(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()

	testSelector(t, twoProviders).ServeHTTP(response, request)
	body, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || string(body) != "{\"providers\":2,\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected health response: status=%d body=%q", response.Code, body)
	}
}

func TestConfigValidation(t *testing.T) {
	t.Parallel()
	config := CreateConfig()
	config.TemplateFile = "page.html"
	config.Providers = []Provider{{ID: "provider/one", Name: "Invalid"}}

	if _, err := New(context.Background(), http.NotFoundHandler(), config, "test-selector"); err == nil {
		t.Fatal("expected invalid provider id to fail")
	}
}
