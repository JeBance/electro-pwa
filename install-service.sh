#!/bin/bash
set -e

SERVICE_NAME="electro-pwa"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PROJECT_DIR="/root/git/electro-pwa"
BACKEND_DIR="${PROJECT_DIR}/backend"

echo "🔧 Creating systemd service for ${SERVICE_NAME}..."

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=ELECTRO PWA - Heater Management System
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=${BACKEND_DIR}
Environment=NODE_ENV=production
Environment=PORT=3002
Environment=DB_HOST=localhost
Environment=DB_PORT=5432
Environment=DB_NAME=electro
Environment=DB_USER=electro_user
Environment=DB_PASSWORD=electro_pass2024
Environment=JWT_SECRET=electro-jwt-secret-production-2026
ExecStart=/usr/bin/node -r dotenv/config ${BACKEND_DIR}/server.js dotenv_config_path=${BACKEND_DIR}/.env
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Service file created: $SERVICE_FILE"
echo ""
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

echo "🚀 Enabling autostart..."
systemctl enable ${SERVICE_NAME}

echo "▶️  Starting service..."
systemctl start ${SERVICE_NAME}

echo ""
echo "✅ Done! Service is running."
echo ""
echo "📊 Useful commands:"
echo "   systemctl status ${SERVICE_NAME}    # Check status"
echo "   journalctl -u ${SERVICE_NAME} -f    # View logs (follow)"
echo "   systemctl stop ${SERVICE_NAME}      # Stop service"
echo "   systemctl restart ${SERVICE_NAME}   # Restart service"
