//go:build android

package tsnetproxy

import (
	"net"
	"net/netip"
	"time"

	"tailscale.com/net/netmon"
)

// Android denies app UIDs the NETLINK_ROUTE socket that Go's net.Interfaces()
// uses, so netmon would fail to start with "route ip+net: netlinkrib:
// permission denied". Register a getter that reports the interface carrying
// the outbound route without touching netlink — the same trick Tailscale's own
// androidbin feature and tailscale_mobile use. This is enough for netmon and
// magicsock to discover local endpoints.
func init() {
	netmon.RegisterInterfaceGetter(androidInterfaces)
}

func androidInterfaces() ([]netmon.Interface, error) {
	var addrs []net.Addr
	if ip, ok := outboundIP("udp4", "8.8.8.8:53"); ok {
		addrs = append(addrs, &net.IPNet{IP: ip.AsSlice(), Mask: net.CIDRMask(32, 32)})
	}
	if ip, ok := outboundIP("udp6", "[2001:4860:4860::8888]:53"); ok {
		addrs = append(addrs, &net.IPNet{IP: ip.AsSlice(), Mask: net.CIDRMask(128, 128)})
	}
	if len(addrs) == 0 {
		// Last resort so netmon still has at least one interface.
		addrs = append(addrs, &net.IPNet{IP: net.IPv4(127, 0, 0, 1), Mask: net.CIDRMask(8, 8)})
	}
	return []netmon.Interface{{
		Interface: &net.Interface{
			MTU:   1500,
			Name:  "android",
			Flags: net.FlagUp | net.FlagRunning,
		},
		AltAddrs: addrs,
	}}, nil
}

// outboundIP dials a UDP socket (which sends no packets) and reports the local
// source address the kernel picked — permitted on Android, unlike netlink.
func outboundIP(network, addr string) (netip.Addr, bool) {
	d := net.Dialer{Timeout: 3 * time.Second}
	c, err := d.Dial(network, addr)
	if err != nil {
		return netip.Addr{}, false
	}
	defer c.Close()
	if ua, ok := c.LocalAddr().(*net.UDPAddr); ok {
		if a, ok := netip.AddrFromSlice(ua.IP); ok {
			return a.Unmap(), true
		}
	}
	return netip.Addr{}, false
}
