#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/provision-ubuntu.sh <domain> <vercelUpstreamHost>
# Example: ./scripts/provision-ubuntu.sh mcp.quickitquote.com qiq-mcp-server-yourproj.vercel.app
# This script:
#  - Installs Docker, Docker Compose plugin, and Nginx
#  - Builds and runs the MCP server container on port 8080
#  - Configures Nginx to proxy:
#       /mcp        -> local WebSocket server (ws upgrade)
#       /mcp/http   -> Vercel Edge function (pure JSON responses)
#  - Enables and restarts Nginx

if [ "${EUID}" -ne 0 ]; then
  echo "Please run as root" >&2
  exit 1
fi

DOMAIN=${1:-}
UPSTREAM=${2:-}
if [ -z "$DOMAIN" ] || [ -z "$UPSTREAM" ]; then
  echo "Usage: $0 <domain> <vercelUpstreamHost>" >&2
  exit 2
fi

apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release

# Install Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/$(. /etc/os-release; echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release; echo "$ID") \
  $(. /etc/os-release; echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Build and run the container
/usr/bin/docker compose -f /root/qiq-mcp-server/docker-compose.yml up -d --build

# Install Nginx
apt-get install -y nginx

# Configure Nginx
cat >/etc/nginx/sites-available/qiq-mcp.conf <<CONF
server {
    listen 80;
    server_name ${DOMAIN};

    # MCP HTTP endpoint: always JSON and proxied to Vercel Edge
    location = /mcp/http {
        default_type application/json;
        proxy_set_header Host ${UPSTREAM};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        client_max_body_size 2m;
        proxy_pass https://${UPSTREAM}/mcp/http;
        error_page 400 401 403 404 405 500 502 503 504 = @json_error;
    }

    location @json_error {
        internal;
        default_type application/json;
        return 200 '{"error":{"code":"upstream_error","message":"Upstream error or bad request"}}';
    }

    # MCP WebSocket endpoint to local Docker container
    location = /mcp {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_pass http://127.0.0.1:8080/mcp;
    }
}
CONF

ln -sf /etc/nginx/sites-available/qiq-mcp.conf /etc/nginx/sites-enabled/qiq-mcp.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "Provision complete. Point DNS of ${DOMAIN} to this server."
