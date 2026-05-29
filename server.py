import os
import json
import urllib.parse
import urllib.request
import base64
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8000
DB_FILE = "database.json"

# Default Database state if file doesn't exist
DEFAULT_DB = {
    "users": [],
    "transactions": [],
    "emergency_reports": [],
    "blacklist": [
        "unknown-lottery@ybl",
        "prize-rewards@paytm",
        "9827389102",
        "win-prize@phonepe"
    ],
    "settings": {
        "spendingLimit": 2000,
        "pipelinesFrozen": False,
        "secureStart": "08:00",
        "secureEnd": "22:00"
    }
}

def init_db():
    if not os.path.exists(DB_FILE):
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_DB, f, indent=4)

def read_db():
    init_db()
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return DEFAULT_DB

def write_db(data):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

class FraudShieldHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        # Allow cross-origin requests for safety
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Parse API endpoints
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path

        if path.startswith("/api/"):
            self.handle_api_get(path)
        else:
            self.handle_static_file(path)

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path

        if path.startswith("/api/"):
            # Read request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                body = json.loads(post_data) if post_data else {}
            except json.JSONDecodeError:
                body = {}
            self.handle_api_post(path, body)
        else:
            self.send_error(404, "Not Found")

    def handle_static_file(self, path):
        # Serve index.html by default
        if path == "/" or path == "":
            file_path = "index.html"
        else:
            file_path = path.lstrip("/")

        # Prevent directory traversal attacks
        normalized_path = os.path.normpath(file_path)
        if normalized_path.startswith("..") or os.path.isabs(normalized_path):
            self.send_error(403, "Forbidden")
            return

        if not os.path.exists(normalized_path) or os.path.isdir(normalized_path):
            self.send_error(404, "File Not Found")
            return

        # Determine MIME type
        content_type = "text/plain"
        if normalized_path.endswith(".html"):
            content_type = "text/html"
        elif normalized_path.endswith(".css"):
            content_type = "text/css"
        elif normalized_path.endswith(".js"):
            content_type = "application/javascript"
        elif normalized_path.endswith(".png"):
            content_type = "image/png"
        elif normalized_path.endswith(".jpg") or normalized_path.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif normalized_path.endswith(".svg"):
            content_type = "image/svg+xml"

        try:
            with open(normalized_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {str(e)}")

    def handle_api_get(self, path):
        db = read_db()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        
        response_data = {}
        
        if path == "/api/blacklist":
            response_data = {"blacklist": db.get("blacklist", [])}
        elif path == "/api/transactions":
            response_data = {"transactions": db.get("transactions", [])}
        elif path == "/api/reports":
            response_data = {"reports": db.get("emergency_reports", [])}
        elif path == "/api/settings":
            response_data = {"settings": db.get("settings", {})}
        elif path == "/api/keys":
            # Read API keys from .api-keys.md
            keys = {}
            keys_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".api-keys.md")
            if os.path.exists(keys_file):
                try:
                    with open(keys_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith('#'):
                                continue
                            if '=' in line:
                                key_name, _, key_value = line.partition('=')
                                key_name = key_name.strip().lower()
                                key_value = key_value.strip()
                                if key_value:
                                    keys[key_name] = key_value
                except Exception:
                    pass
            response_data = {"success": True, "keys": keys}
        else:
            self.send_response(404)
            response_data = {"error": "API route not found"}

        response_bytes = json.dumps(response_data).encode('utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def handle_api_post(self, path, body):
        db = read_db()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        
        response_data = {"success": False}

        try:
            if path == "/api/auth/signup":
                full_name = body.get("fullName", "").strip()
                pin = body.get("pin", "").strip()
                recovery = body.get("recovery", "").strip()
                language = body.get("language", "en")

                if not full_name or not pin or not recovery:
                    response_data = {"success": False, "message": "Missing required fields."}
                elif any(u["fullName"].lower() == full_name.lower() for u in db["users"]):
                    response_data = {"success": False, "message": "A profile with this name already exists."}
                else:
                    new_user = {
                        "fullName": full_name,
                        "pin": pin,
                        "recovery": recovery,
                        "language": language
                    }
                    db["users"].append(new_user)
                    write_db(db)
                    response_data = {"success": True, "message": "Profile created successfully!"}

            elif path == "/api/auth/login":
                full_name = body.get("fullName", "").strip()
                pin = body.get("pin", "").strip()

                user = next((u for u in db["users"] if u["fullName"].lower() == full_name.lower()), None)
                if not user:
                    response_data = {"success": False, "message": "Profile not found."}
                elif user["pin"] != pin:
                    response_data = {"success": False, "message": "Incorrect Security PIN."}
                else:
                    response_data = {
                        "success": True, 
                        "message": "Login successful!",
                        "user": {
                            "fullName": user["fullName"],
                            "language": user["language"]
                        }
                    }

            elif path == "/api/auth/recover":
                full_name = body.get("fullName", "").strip()
                recovery = body.get("recovery", "").strip()

                user = next((u for u in db["users"] if u["fullName"].lower() == full_name.lower()), None)
                if not user:
                    response_data = {"success": False, "message": "Profile not found."}
                elif user["recovery"].lower() != recovery.lower():
                    response_data = {"success": False, "message": "Incorrect recovery response."}
                else:
                    response_data = {"success": True, "pin": user["pin"]}

            elif path == "/api/transactions":
                db["transactions"].insert(0, body)
                write_db(db)
                response_data = {"success": True}

            elif path == "/api/blacklist":
                target = body.get("target", "").strip()
                if target and target not in db["blacklist"]:
                    db["blacklist"].append(target)
                    write_db(db)
                response_data = {"success": True, "blacklist": db["blacklist"]}

            elif path == "/api/reports":
                db["emergency_reports"].insert(0, body)
                write_db(db)
                response_data = {"success": True}

            elif path == "/api/settings":
                db["settings"].update(body)
                write_db(db)
                response_data = {"success": True, "settings": db["settings"]}

            elif path == "/api/proxy/virustotal":
                # VirusTotal API Proxy (avoids CORS)
                api_key = body.get("apiKey", "")
                target_url = body.get("url", "")
                if not api_key or not target_url:
                    response_data = {"success": False, "message": "Missing apiKey or url"}
                else:
                    try:
                        # Step 1: Submit URL for scanning
                        url_id = base64.urlsafe_b64encode(target_url.encode()).decode().strip("=")
                        vt_url = f"https://www.virustotal.com/api/v3/urls/{url_id}"
                        req = urllib.request.Request(vt_url)
                        req.add_header("x-apikey", api_key)
                        req.add_header("Accept", "application/json")
                        
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            vt_data = json.loads(resp.read().decode())
                        
                        stats = vt_data.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
                        total = sum(stats.values()) if stats else 0
                        response_data = {
                            "success": True,
                            "stats": {
                                "malicious": stats.get("malicious", 0),
                                "suspicious": stats.get("suspicious", 0),
                                "harmless": stats.get("harmless", 0),
                                "undetected": stats.get("undetected", 0),
                                "total": total
                            }
                        }
                    except Exception as vt_err:
                        response_data = {"success": False, "message": f"VirusTotal error: {str(vt_err)}"}

            else:
                self.send_response(404)
                response_data = {"success": False, "message": "API endpoint not found."}

        except Exception as e:
            traceback.print_exc()
            response_data = {"success": False, "message": f"Server error: {str(e)}"}

        response_bytes = json.dumps(response_data).encode('utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

def run_server():
    init_db()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, FraudShieldHandler)
    print(f"🚀 FraudShield AI Local Backend running at: http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
