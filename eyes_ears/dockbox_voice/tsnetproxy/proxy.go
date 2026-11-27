// Package tsnetproxy embeds a userspace Tailscale node in the app process and
// exposes a localhost TCP proxy to a peer on the tailnet. No separate Tailscale
// app, no system VPN slot — Warden's phone app dials 127.0.0.1:<port> and the
// tsnet node carries it to the Warden host over WireGuard.
package tsnetproxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

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

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
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

// StartProxy listens on 127.0.0.1:localPort and forwards each accepted
// connection to targetHost:targetPort over the tailnet node. Returns once the
// listener is up; the accept loop runs in the background.
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
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		setErr(err)
		return err
	}
	mu.Lock()
	listener = ln
	mu.Unlock()

	target := net.JoinHostPort(targetHost, fmt.Sprintf("%d", targetPort))
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				d, err := s.Dial(ctx, "tcp", target)
				cancel()
				if err != nil {
					setErr(err)
					return
				}
				defer d.Close()
				done := make(chan struct{}, 2)
				go func() { io.Copy(d, c); done <- struct{}{} }()
				go func() { io.Copy(c, d); done <- struct{}{} }()
				<-done
			}(c)
		}
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
