#!/bin/bash
# Sync Cloudflare IP ranges mới nhất và update UFW rules
set -e

CF_IPS_V4=$(curl -s https://www.cloudflare.com/ips-v4)
CF_IPS_V6=$(curl -s https://www.cloudflare.com/ips-v6)

# Xóa rules cũ của CF
ufw status numbered | grep "Cloudflare" | awk -F'[][]' '{print $2}' | sort -rn | while read num; do
    ufw --force delete $num
done

# Thêm rules mới
for ip in $CF_IPS_V4 $CF_IPS_V6; do
    ufw allow from $ip to any port 443 comment "Cloudflare"
done

# Update snippets/cloudflare-ips.conf
OUTPUT="/etc/nginx/snippets/cloudflare-ips.conf"
echo "# Auto-generated: $(date)" > $OUTPUT
echo "# Cloudflare IP ranges" >> $OUTPUT
for ip in $CF_IPS_V4 $CF_IPS_V6; do
    echo "allow $ip;" >> $OUTPUT
done
echo "deny all;" >> $OUTPUT

nginx -t && systemctl reload nginx
echo "Updated $(echo "$CF_IPS_V4 $CF_IPS_V6" | wc -w) Cloudflare IP ranges"
