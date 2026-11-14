#!/usr/bin/env bash
# Instala Votapp en una VM Debian/Ubuntu (pensado para la e2-micro gratis de Google Cloud).
# Uso (como root, desde el repo clonado en /opt/votapp):
#   sudo /opt/votapp/deploy/setup.sh votapp-ramiro.duckdns.org [DUCKDNS_TOKEN]
# Es idempotente: se puede volver a correr.
set -euo pipefail

DOMAIN=${1:?Uso: setup.sh DOMINIO [DUCKDNS_TOKEN]}
DUCK_TOKEN=${2:-}
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
DATA=/var/lib/votapp
ENV=/etc/votapp.env
[ "$(id -u)" = 0 ] || { echo "Correlo como root (sudo)"; exit 1; }

echo "==> Swap de 1 GB (la e2-micro tiene 1 GB de RAM)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Paquetes: Node 22, Caddy, sqlite3"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git sqlite3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "==> Usuario y dependencias"
id votapp >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin votapp
install -d -o votapp -g votapp -m 750 "$DATA"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "==> Configuración ($ENV)"
if [ ! -f "$ENV" ]; then
  cat > "$ENV" <<CONF
PORT=3000
ORIGIN=https://$DOMAIN
DB_PATH=$DATA/votapp.db
WA_AUTH_DIR=$DATA/wa-auth
# Número del bot con código de país, sin + (ej: 5491112345678). Solo hace falta para vincular la primera vez.
WA_PAIR_NUMBER=
# JID del grupo (aparece en el log una vez vinculado el bot).
WA_GROUP=
CONF
  chmod 640 "$ENV" && chgrp votapp "$ENV"
fi

echo "==> Servicio systemd"
cat > /etc/systemd/system/votapp.service <<UNIT
[Unit]
Description=Votapp
After=network-online.target
Wants=network-online.target

[Service]
User=votapp
EnvironmentFile=$ENV
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --no-warnings $APP_DIR/src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now votapp >/dev/null
systemctl restart votapp

echo "==> Caddy (HTTPS automático con Let's Encrypt)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "==> CLI: votapp-cli"
cat > /usr/local/bin/votapp-cli <<CLI
#!/bin/sh
set -a; . $ENV; set +a
exec runuser -u votapp -- /usr/bin/node --no-warnings $APP_DIR/src/cli.js "\$@"
CLI
chmod 755 /usr/local/bin/votapp-cli

echo "==> Backup diario de la base (14 días en /var/backups/votapp)"
install -d -m 700 /var/backups/votapp
cat > /etc/cron.daily/votapp-backup <<'BK'
#!/bin/sh
f=/var/backups/votapp/votapp-$(date +%F).db
sqlite3 /var/lib/votapp/votapp.db ".backup '$f'" && gzip -f "$f"
find /var/backups/votapp -name 'votapp-*.db.gz' -mtime +14 -delete
BK
chmod 755 /etc/cron.daily/votapp-backup

if [ -n "$DUCK_TOKEN" ]; then
  echo "==> DuckDNS (actualiza la IP cada 5 minutos)"
  SUB=${DOMAIN%%.duckdns.org}
  install -m 600 /dev/null /etc/votapp-duckdns
  echo "url=\"https://www.duckdns.org/update?domains=$SUB&token=$DUCK_TOKEN&ip=\"" > /etc/votapp-duckdns
  echo "*/5 * * * * root curl -fsS -K /etc/votapp-duckdns -o /dev/null" > /etc/cron.d/votapp-duckdns
  curl -fsS -K /etc/votapp-duckdns -o /dev/null
fi

cat <<FIN

Listo. Próximos pasos:
  1. Poné el número del bot en WA_PAIR_NUMBER:   sudo nano $ENV && sudo systemctl restart votapp
  2. Mirá el log y cargá el código en el celu del bot (Dispositivos vinculados > Vincular con número):
       sudo journalctl -u votapp -f
  3. Metelo al grupo; el log lista los grupos con su JID. Copialo a WA_GROUP y reiniciá.
  4. Link de invitación:   sudo votapp-cli invite
     El primero que se registra queda admin.
FIN
