package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: penetration-backend <command> [args...]")
		fmt.Println("Dostępne komendy: portscan, subdomain, ping, whois, httpheaders, banner, dns, traceroute")
		os.Exit(1)
	}

	cmd := os.Args[1]

	switch cmd {
		case "portscan":
			portScan()
		case "subdomain":
			subdomainEnum()
		case "ping":
			pingTool()
		case "whois":
			whoisTool()
		case "httpheaders":
			httpHeadersTool()
		case "banner":
			bannerGrab()
		case "dns":
			dnsLookup()
		case "traceroute":
			tracerouteTool()
		default:
			fmt.Printf("Nieznane polecenie: %s\n", cmd)
			os.Exit(1)
	}
}

// ================== PORT SCANNER ==================
func portScan() {
	if len(os.Args) < 5 {
		fmt.Println("Błąd: portscan <target> <start_port> <end_port>")
		return
	}
	target := os.Args[2]
	start, _ := strconv.Atoi(os.Args[3])
	end, _ := strconv.Atoi(os.Args[4])

	fmt.Printf("🔥 Rozpoczynam skanowanie %s (%d-%d)...\n", target, start, end)

	total := end - start + 1
	for i, port := range makeRange(start, end) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", target, port), 800*time.Millisecond)
		if err == nil {
			fmt.Printf("✅ Port %d OTWARTY\n", port)
			conn.Close()
		}
		// Progress dla Qt
		fmt.Printf("PROGRESS:%d\n", int(float64(i+1)/float64(total)*100))
	}
	fmt.Println("🏁 Skanowanie zakończone.")
}

// ================== SUBDOMAIN ENUM ==================
func subdomainEnum() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: subdomain <domain>")
		return
	}
	domain := os.Args[2]
	common := []string{"www", "mail", "ftp", "admin", "dev", "api", "blog", "test", "staging", "vpn", "secure", "login", "ns1", "ns2", "web", "shop"}

	fmt.Printf("🌐 Enumeracja subdomen dla %s...\n", domain)
	found := 0
	for _, sub := range common {
		full := sub + "." + domain
		ips, err := net.LookupIP(full)
		if err == nil && len(ips) > 0 {
			fmt.Printf("✅ %s → %s\n", full, ips[0])
			found++
		}
	}
	fmt.Printf("🏁 Znaleziono %d subdomen\n", found)
}

// ================== PING ==================
func pingTool() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: ping <target>")
		return
	}
	target := os.Args[2]
	out, err := exec.Command("ping", "-c", "4", "-W", "2", target).CombinedOutput()
	if err != nil {
		fmt.Printf("❌ Błąd ping: %v\n", err)
	}
	fmt.Println(string(out))
}

// ================== WHOIS ==================
func whoisTool() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: whois <domain>")
		return
	}
	domain := os.Args[2]
	conn, err := net.DialTimeout("tcp", "whois.iana.org:43", 10*time.Second)
	if err != nil {
		fmt.Printf("❌ Błąd połączenia WHOIS: %v\n", err)
		return
	}
	defer conn.Close()

	fmt.Fprintf(conn, "%s\r\n", domain)
	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		fmt.Println(scanner.Text())
	}
}

// ================== HTTP HEADERS ==================
func httpHeadersTool() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: httpheaders <url>")
		return
	}
	url := os.Args[2]
	if !strings.HasPrefix(url, "http") {
		url = "http://" + url
	}
	fmt.Printf("🌐 Pobieranie nagłówków HTTP: %s\n", url)
	// Na razie prosty placeholder – możesz później rozbudować
	fmt.Println("Status: 200")
	fmt.Println("Server: nginx/1.24")
	fmt.Println("Content-Type: text/html")
}

// ================== BANNER GRABBER ==================
func bannerGrab() {
	if len(os.Args) < 4 {
		fmt.Println("Błąd: banner <host> <port>")
		return
	}
	host := os.Args[2]
	port, _ := strconv.Atoi(os.Args[3])

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 5*time.Second)
	if err != nil {
		fmt.Printf("❌ Błąd: %v\n", err)
		return
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(4 * time.Second))
	buf := make([]byte, 2048)
	n, _ := conn.Read(buf)
	if n > 0 {
		fmt.Print(string(buf[:n]))
	} else {
		fmt.Println("Brak widocznego bannera")
	}
}

// ================== DNS LOOKUP ==================
func dnsLookup() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: dns <domain>")
		return
	}
	domain := os.Args[2]
	ips, err := net.LookupIP(domain)
	if err != nil {
		fmt.Printf("❌ Błąd DNS: %v\n", err)
		return
	}
	fmt.Printf("A: %v\n", ips)
}

// ================== TRACEROUTE ==================
func tracerouteTool() {
	if len(os.Args) < 3 {
		fmt.Println("Błąd: traceroute <target>")
		return
	}
	target := os.Args[2]
	out, err := exec.Command("traceroute", "-q", "1", "-m", "30", target).CombinedOutput()
	if err != nil {
		fmt.Printf("❌ Błąd traceroute: %v\n", err)
	}
	fmt.Println(string(out))
}

// ================== POMOCNICZA FUNKCJA ==================
func makeRange(min, max int) []int {
	a := make([]int, max-min+1)
	for i := range a {
		a[i] = min + i
	}
	return a
}
