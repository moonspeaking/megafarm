#!/usr/bin/env python3
"""Tiny static file server with cache disabled (for development)."""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


class TCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving on http://localhost:{PORT}")
    httpd.serve_forever()
