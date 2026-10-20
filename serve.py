# serve.py - a tiny local web server for QR Paint, for use while developing.
# It works like "python -m http.server", but tells the browser NOT to cache files,
# so every refresh loads the newest index.html, style.css and app.js.
# Run it with:  python serve.py   then open http://localhost:8080

import http.server  # Python's built-in web server tools (nothing to install)
import os  # lets us find this file's folder

PORT = 8080  # the "door number" the server listens on; open http://localhost:8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):  # our own handler, based on the standard file-serving one
    def end_headers(self):  # runs just before each response is sent; headers are extra info sent along with a file
        self.send_header("Cache-Control", "no-store")  # "no-store" = browser, don't keep a copy of this file
        super().end_headers()  # then do the normal work of the original handler


os.chdir(os.path.dirname(os.path.abspath(__file__)))  # serve files from the folder this script is in (the project folder)
server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)  # 127.0.0.1 = only this computer can connect
print(f"QR Paint running at http://localhost:{PORT}  (press Ctrl+C to stop)")  # tell the user where to go
server.serve_forever()  # keep answering browser requests until stopped
