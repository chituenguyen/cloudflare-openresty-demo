# Cloudflare Setup

> Đây là ghi chép thực tế những gì đã được cấu hình cho `blog360.org` — server `157.20.83.195`.

## 1. DNS

2 A record đã thêm, **Proxy bật (orange cloud)**:

| Name | Type | Content | Proxy |
|------|------|---------|-------|
| `blog360.org` | A | `157.20.83.195` | Proxied |
| `api.blog360.org` | A | `157.20.83.195` | Proxied |

> Bật Proxy để traffic đi qua Cloudflare edge — ẩn IP thật và kích hoạt các tính năng bảo mật.

---

## 2. SSL/TLS Mode

**SSL/TLS → Overview → Full (strict)** ✅ đã set

Bắt buộc dùng **Full (strict)** vì server dùng Cloudflare Origin Certificate.
- `Flexible` → server nhận HTTP, không an toàn
- `Full` → server nhận HTTPS nhưng không verify cert
- `Full (strict)` → server phải có cert hợp lệ (Origin Cert hoặc Let's Encrypt)

---

## 3. Origin Certificate

Cloudflare cấp cert để encrypt traffic giữa Cloudflare edge → server (origin). ✅ đã cấp

**SSL/TLS → Origin Server → Create Certificate**

Đã cấu hình:
- **Hostnames:** `blog360.org`, `*.blog360.org`
- **Validity:** 15 years
- **Key type:** RSA 2048

Cert và key đã lưu vào server tại:
```
/etc/nginx/certs/origin.pem   ← certificate
/etc/nginx/certs/origin.key   ← private key (chmod 600)
```

> **KHÔNG commit** file `.key` vào git. Nếu mất, tạo lại cert mới trên Cloudflare dashboard.

---

## 4. Bot Fight Mode

**Security → Bots → Bot Fight Mode → ON** ✅ đã bật

Chặn các bot đã biết (scrapers, crawlers, scanners) trước khi request vào server.

---

## 5. Cloudflare Turnstile

**Turnstile** là CAPTCHA alternative của Cloudflare — không hiển thị puzzle, verify ngầm. ✅ đã tạo

**Turnstile → Widget đã tạo:**
- Name: `blog360`
- Hostname: `blog360.org`
- Widget mode: **Managed** (CF tự quyết challenge hay pass ngầm)

Credentials đã lấy:
- **Sitekey** (public): `0x4AAAAAACyZrJBXCa_xSjxb` → hardcode trong `fe/app/page.tsx`
- **Secret key** (sensitive): lưu trong `backend/.env` — `TURNSTILE_SECRET=...`

> **Secret key KHÔNG commit** vào git. Nếu bị lộ → Turnstile dashboard → Rotate secret.

**Cách hoạt động:**
1. Frontend render Turnstile widget (managed — user không thấy gì nếu pass)
2. Widget trả về `turnstileToken`
3. Frontend POST token lên `POST /auth/token`
4. Backend verify với Cloudflare API → nếu valid → issue JWT 30 min
5. Frontend lưu JWT vào localStorage, dùng cho mọi API call tiếp theo
6. Khi JWT còn < 5 min → silent background refresh (không block UX)

---

## 6. UFW — Chỉ cho phép Cloudflare IPs ✅ đã set

Server chỉ nhận traffic port 80/443 từ Cloudflare, block direct access.

```bash
# Xóa rule allow anywhere cũ cho port 80/443
ufw delete allow 80/tcp
ufw delete allow 443/tcp

# Thêm từng Cloudflare IP range (IPv4)
for ip in \
  173.245.48.0/20 \
  103.21.244.0/22 \
  103.22.200.0/22 \
  103.31.4.0/22 \
  141.101.64.0/18 \
  108.162.192.0/18 \
  190.93.240.0/20 \
  188.114.96.0/20 \
  197.234.240.0/22 \
  198.41.128.0/17 \
  162.158.0.0/15 \
  104.16.0.0/13 \
  104.24.0.0/14 \
  172.64.0.0/13 \
  131.0.72.0/22; do
  ufw allow from $ip to any port 80,443 proto tcp
done
```

Script cập nhật tự động: `infra/scripts/update-cf-ips.sh`

> Sau khi lock UFW, test kết nối qua Cloudflare (domain), không phải direct IP.

---

## 7. Kiểm tra hoạt động

```bash
# Kiểm tra request đi qua Cloudflare
curl -I https://blog360.org
# Response phải có header: cf-ray, server: cloudflare

# Kiểm tra direct access bị block
curl -I http://<server-ip>
# Response: connection refused hoặc timeout

# Kiểm tra JWT flow
curl -X POST https://api.blog360.org/auth/token \
  -H "Content-Type: application/json" \
  -d '{"turnstileToken": "test"}'
# Expected: 403 Turnstile failed (vì token fake)
```

---

## Security layers tổng hợp

```
Internet
  │
  ▼
Cloudflare Edge
  ├── Bot Fight Mode        → chặn bot đã biết
  ├── Turnstile (Managed)   → verify real user trước khi cấp JWT
  ├── DDoS protection       → auto-mitigate layer 3/4/7
  └── Full (Strict) SSL     → encrypt toàn bộ path
  │
  ▼ (chỉ Cloudflare IPs)
UFW Firewall
  └── Chỉ allow port 80/443 từ Cloudflare IP ranges
  │
  ▼
OpenResty (Nginx + Lua)
  ├── Rate limit: 10 req/s burst 20
  ├── Security headers (HSTS, CSP, X-Frame-Options...)
  ├── Block bad user agents
  └── JWT verify bằng Lua (gateway level, trước khi vào Node)
  │
  ▼
Fail2ban
  └── Auto-ban: 10× 403 trong 60s → ban 1h
                 5× 429 trong 60s → ban 2h
  │
  ├──► Next.js FE :4000
  └──► Fastify BE :3001
         └── POST /auth/token: verify Turnstile → issue JWT 30min
```
