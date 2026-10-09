#!/usr/bin/env python3
"""
Chennai Transit Explorer — Local Server Launcher
Serves the web application and interactive map viewer locally.
"""

import os
import sys
import socket
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Ensure standard UTF-8 output across Windows consoles
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

class CustomHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
        super().__init__(*args, directory=web_dir, **kwargs)

    def end_headers(self):
        # Enable CORS and caching headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Clean logging
        try:
            sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} - {args[1]} - {args[2]}\n")
        except Exception:
            pass

def find_free_port(preferred_port=5000):
    for port in [preferred_port, 5001, 8000, 8080, 8888]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
    return preferred_port

def main():
    port = find_free_port(5000)
    server_address = ('127.0.0.1', port)
    
    # Ensure data files exist
    web_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'data')
    metro_file = os.path.join(web_data_dir, 'metro.json')
    mtc_file = os.path.join(web_data_dir, 'mtc_data.json')

    if not (os.path.exists(metro_file) and os.path.exists(mtc_file)):
        print("Pre-processed data missing. Generating now...")
        import scripts.build_web_data as builder
        builder.build_data()

    httpd = HTTPServer(server_address, CustomHandler)
    url = f"http://localhost:{port}"

    print("=" * 60)
    print("  CHENNAI TRANSIT EXPLORER - MAP VIEWER")
    print("=" * 60)
    print(f"  [+] Serving at: {url}")
    print("  [+] Press Ctrl+C to stop the server")
    print("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Chennai Transit Explorer server.")
        httpd.server_close()

if __name__ == '__main__':
    main()
