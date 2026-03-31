#!/bin/bash
# Server setup từ đầu (Ubuntu 22.04)
set -e

echo "[1/6] Update packages"
apt update && apt upgrade -y

echo "[2/6] Install dependencies"
apt install -y nginx fail2ban ufw docker.io docker-compose curl

echo "[3/6] UFW firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP (redirect sang HTTPS)
ufw allow 443/tcp       # HTTPS

# Chỉ allow port 443 từ Cloudflare IP ranges
# (chạy update-cf-ips.sh để apply rules chi tiết)
ufw enable

echo "[4/6] Nginx config"
cp -r ../nginx/nginx.conf /etc/nginx/nginx.conf
cp -r ../nginx/snippets/* /etc/nginx/snippets/
cp -r ../nginx/sites/* /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/fe.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "[5/6] Fail2ban"
cp ../fail2ban/jail.local /etc/fail2ban/jail.local
cp ../fail2ban/filter.d/* /etc/fail2ban/filter.d/
systemctl enable fail2ban && systemctl restart fail2ban

echo "[6/6] SSH hardening"
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd

echo "Done. Đặt Origin Certificate vào /etc/nginx/certs/ rồi reload nginx."
