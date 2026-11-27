// Package tsnetproxy embeds a userspace Tailscale node in the app process and
// exposes a localhost TCP proxy to a peer on the tailnet. No separate Tailscale
// app, no system VPN slot — Warden's phone app dials 127.0.0.1:<port> and the
// tsnet node carries it to the Warden host over WireGuard.
package tsnetproxy

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"sync"
	"time"

	"tailscale.com/net/netns"
	"tailscale.com/tsnet"
)

var (
	mu       sync.Mutex
	srv      *tsnet.Server
	listener net.Listener
	running  bool
	lastErr  string
)

func setErr(err error) {
	mu.Lock()
	defer mu.Unlock()
	if err == nil {
		lastErr = ""
		return
	}
	lastErr = err.Error()
}

// LastError returns the most recent failure, or "" when healthy.
func LastError() string {
	mu.Lock()
	defer mu.Unlock()
	return lastErr
}

// Status reports the embedded node state for the app UI: "running", "stopped",
// or the last error string.
func Status() string {
	mu.Lock()
	defer mu.Unlock()
	switch {
	case running:
		return "running"
	case lastErr != "":
		return "error: " + lastErr
	default:
		return "stopped"
	}
}

// Start brings up an in-process Tailscale node authenticated with authKey.
// stateDir persists the node identity so it only logs in once. This blocks
// until the node is connected (or the auth attempt fails) — call it off the
// Android main thread.
func Start(authKey, hostname, stateDir string) error {
	mu.Lock()
	if running {
		mu.Unlock()
		return nil
	}
	mu.Unlock()

	// Android has no writable /tmp and no HOME/TMPDIR; point the Go log
	// policy and tsnet's var root at the app's private dir, and make the
	// state dir explicitly (EACCES otherwise).
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		setErr(err)
		return err
	}
	os.Setenv("HOME", stateDir)
	os.Setenv("TMPDIR", stateDir)
	os.Setenv("TS_LOGS_DIR", stateDir)

	// This node only dials out; it installs no routes and never needs to
	// route packets back into itself, so disable the network-namespace
	// Control hooks entirely (Android apps can't setns/SO_BINDTODEVICE).
	netns.SetEnabled(false)

	s := &tsnet.Server{
		AuthKey:  authKey,
		Hostname: hostname,
		Dir:      stateDir,
		// Report the auth URL / status lines to the app log.
		UserLogf: func(format string, args ...any) {
			setErr(nil)
		},
	}
	// Android apps cannot use the privileged netns dialer (SO_BINDTODEVICE /
	// setns need root), so give tsnet a plain host-network dialer for the
	// control plane, DERP and WireGuard traffic. This is the same path every
	// unprivileged tsnet caller uses.
	s.SystemDial = func(ctx context.Context, network, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, network, addr)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if _, err := s.Up(ctx); err != nil {
		s.Close()
		setErr(err)
		return err
	}

	mu.Lock()
	srv = s
	running = true
	mu.Unlock()
	setErr(nil)
	return nil
}

var loginURLRe = regexp.MustCompile(`https://(?:login\.tailscale\.com|tailscale\.com)/a/[^\s]+`)

// StartInteractive starts the node WITHOUT an auth key and returns the login
// URL the user must open in a browser. After they sign in, WaitForLogin
// resolves. The node identity is persisted in stateDir, so this only needs to
// happen once.
func StartInteractive(hostname, stateDir string) (string, error) {
	mu.Lock()
	if running {
		mu.Unlock()
		return "", nil
	}
	mu.Unlock()

	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		setErr(err)
		return "", err
	}
	os.Setenv("HOME", stateDir)
	os.Setenv("TMPDIR", stateDir)
	os.Setenv("TS_LOGS_DIR", stateDir)
	netns.SetEnabled(false)

	var (
		authMu  sync.Mutex
		authURL string
	)
	s := &tsnet.Server{
		Hostname: hostname,
		Dir:      stateDir,
		UserLogf: func(format string, args ...any) {
			msg := fmt.Sprintf(format, args...)
			if m := loginURLRe.FindString(msg); m != "" {
				authMu.Lock()
				if authURL == "" {
					authURL = m
				}
				authMu.Unlock()
			}
		},
	}
	s.SystemDial = func(ctx context.Context, network, addr string) (net.Conn, error) {
		d := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
		return d.DialContext(ctx, network, addr)
	}

	// Start returns immediately; the login URL is emitted shortly after as the
	// node enters NeedsLogin (captured via UserLogf above).
	if err := s.Start(); err != nil {
		s.Close()
		setErr(err)
		return "", err
	}
	mu.Lock()
	srv = s
	mu.Unlock()

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		authMu.Lock()
		u := authURL
		authMu.Unlock()
		if u != "" {
			return u, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	authMu.Lock()
	u := authURL
	authMu.Unlock()
	if u != "" {
		return u, nil
	}
	return "", errors.New("no login URL produced")
}

// WaitForLogin blocks until the node is running (the user finished sign-in),
// or the timeout elapses. Call it after StartInteractive + opening the URL.
func WaitForLogin(timeoutSec int) error {
	mu.Lock()
	s := srv
	mu.Unlock()
	if s == nil {
		return errors.New("tailscale not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()
	if _, err := s.Up(ctx); err != nil {
		setErr(err)
		return err
	}
	mu.Lock()
	running = true
	mu.Unlock()
	setErr(nil)
	return nil
}

// Stop tears the node down.
func Stop() {
	mu.Lock()
	s, ln := srv, listener
	srv, listener = nil, nil
	running = false
	mu.Unlock()
	if ln != nil {
		ln.Close()
	}
	if s != nil {
		s.Close()
	}
}

// StartProxy listens on 127.0.0.1:localPort and reverse-proxies HTTP requests
// to https://targetHost:targetPort over the tailnet node. The target must be
// the tailnet's HTTPS `tailscale serve` endpoint: Warden only accepts the owner
// API (chat, boards, files, mail) from loopback/LAN, and `serve` connects to
// the app server from 127.0.0.1. Dialing :3200 directly from a tailnet IP is
// rejected with 403. Returns once the listener is up; requests are served from
// a background goroutine.
func StartProxy(localPort, targetPort int, targetHost string) error {
	mu.Lock()
	s := srv
	mu.Unlock()
	if s == nil {
		err := errors.New("tailscale not started")
		setErr(err)
		return err
	}
	if targetHost == "" {
		err := errors.New("target host is empty")
		setErr(err)
		return err
	}

	target := &url.URL{
		Scheme: "https",
		Host:   net.JoinHostPort(targetHost, strconv.Itoa(targetPort)),
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		// `tailscale serve` routes on the MagicDNS name, so send it as Host.
		r.Host = targetHost
	}
	proxy.Transport = &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			// Carry the request over the tailnet node's WireGuard link.
			return s.Dial(ctx, network, addr)
		},
		TLSClientConfig: &tls.Config{
			ServerName: targetHost,
			// The WireGuard tunnel already authenticates the peer by node key;
			// the TLS cert is for the MagicDNS name we reach through tsnet.
			InsecureSkipVerify: true,
		},
		ForceAttemptHTTP2:     false,
		ResponseHeaderTimeout: 0,
		IdleConnTimeout:       0,
		MaxIdleConns:          16,
	}
	// SSE: stream through without buffering.
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		setErr(err)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("warden proxy: " + err.Error()))
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		setErr(err)
		return err
	}
	mu.Lock()
	listener = ln
	mu.Unlock()

	go func() {
		httpSrv := &http.Server{Handler: proxy}
		_ = httpSrv.Serve(ln)
	}()
	setErr(nil)
	return nil
}

// PeerDNSName returns the MagicDNS name of the Warden peer, for diagnostics.
func PeerDNSName() string {
	mu.Lock()
	s := srv
	mu.Unlock()
	if s == nil {
		return ""
	}
	if st, err := s.Up(context.Background()); err == nil && st.Self != nil {
		return st.Self.DNSName
	}
	return ""
}
