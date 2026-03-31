# Planning: Secure JSON API Service

## Mục tiêu
- **Backend**: REST API trả về JSON
- **Frontend**: Hiển thị JSON đơn giản
- **Infra**: Cloudflare (edge) → Dedicated server + Nginx với security layers

---

## Source Structure

```
project/
├── backend/          # API service
├── frontend/         # JSON viewer
└── infra/            # Nginx config + security
```

---

## Source 1: `backend/`

**Stack**: Node.js (Fastify) hoặc Python (FastAPI)

```
backend/
├── src/
│   ├── routes/
│   │   └── api.js          # GET /api/v1/* → JSON
│   ├── middleware/
│   │   ├── token.js         # Verify request token
│   │   └── rateLimit.js     # Per-IP rate limiting
│   └── index.js
├── .env
└── package.json
```

**Tasks:**
- [ ] Khởi tạo project (Fastify/FastAPI)
- [ ] Route cơ bản `GET /api/v1/data` → trả JSON
- [ ] Health check endpoint `GET /health`
- [ ] Middleware verify token (đọc header `x-request-token`)
- [ ] Middleware rate limit (dùng Redis hoặc in-memory)
- [ ] CORS config: chỉ accept từ domain FE
- [ ] Dockerfile

---

## Source 2: `frontend/`

**Stack**: Next.js hoặc plain HTML + vanilla JS

```
frontend/
├── src/
│   ├── pages/
│   │   └── index.tsx        # Fetch + render JSON
│   └── lib/
│       └── api.ts           # Gọi backend, attach token
├── public/
└── package.json
```

**Tasks:**
- [ ] Khởi tạo project
- [ ] Page hiển thị JSON response (collapsible tree hoặc raw)
- [ ] Tích hợp Cloudflare Turnstile (invisible)
  - Lấy token từ Turnstile widget
  - Attach vào header mỗi request tới backend
- [ ] Handle error states (403, 429, 500)
- [ ] Dockerfile

---

## Source 3: `infra/`

```
infra/
├── cloudflare/
│   ├── waf-rules.md          # Custom WAF rules (ghi lại để tái tạo)
│   └── page-rules.md         # Cache rules, redirect rules
├── nginx/
│   ├── nginx.conf            # Main config
│   ├── sites/
│   │   ├── api.conf          # Backend proxy
│   │   └── fe.conf           # Frontend proxy
│   └── snippets/
│       ├── security.conf     # Security headers
│       ├── rate-limit.conf   # Rate limiting zones
│       ├── ssl.conf          # TLS config (Origin cert)
│       └── cloudflare-ips.conf  # Whitelist Cloudflare IP ranges
├── fail2ban/
│   ├── jail.local            # Banning rules
│   └── filter.d/
│       └── nginx-api.conf    # Custom filter cho API abuse
├── scripts/
│   ├── setup.sh              # Server setup từ đầu
│   ├── update-cf-ips.sh      # Sync Cloudflare IP ranges mới nhất
│   ├── renew-cert.sh         # Let's Encrypt renew (nếu dùng Origin cert thì skip)
│   └── ban-ip.sh             # Manual ban helper
└── docker-compose.yml        # Orchestrate backend + frontend
```

**Tasks:**

### Cloudflare
- [ ] Trỏ domain về Cloudflare (nameserver)
- [ ] SSL/TLS mode: **Full (strict)** — Cloudflare ↔ Origin dùng cert thật
- [ ] Tạo Cloudflare Origin Certificate → cài lên Nginx (thay Let's Encrypt)
- [ ] Bật **Bot Fight Mode** (free) — chặn known bots tự động
- [ ] WAF rule: block request không có `CF-Connecting-IP` header (direct bypass attempt)
- [ ] WAF rule: rate limit `/api/*` 100 req/min per IP tại edge
- [ ] WAF rule: block TOR exit nodes + known datacenter ASN (optional, aggressive)
- [ ] Turnstile: tạo sitekey (free) cho domain
- [ ] **Quan trọng**: Firewall server chỉ accept traffic từ Cloudflare IP ranges
  - UFW: chỉ allow port 443 từ Cloudflare IP, block tất cả direct access

### Nginx
- [ ] Reverse proxy: Nginx → backend (port 3000), frontend (port 4000)
- [ ] TLS: Cloudflare Origin Certificate (thay vì Let's Encrypt)
- [ ] Chỉ accept kết nối từ Cloudflare IP ranges (`cloudflare-ips.conf`)
- [ ] Restore real IP từ `CF-Connecting-IP` header (để rate limit đúng IP user)
- [ ] HTTP → HTTPS redirect
- [ ] Rate limiting zones:
  - `limit_req_zone` theo IP: 30 req/min cho `/api/`
  - `limit_req_zone` theo IP: 5 req/s burst cho `/api/v1/data`
- [ ] Block bad UA: curl, python-requests, scrapy, etc.
- [ ] Security headers:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy`
  - `Strict-Transport-Security`
- [ ] Block common scan paths (`/.env`, `/wp-admin`, `/phpinfo`, etc.)
- [ ] ModSecurity WAF (optional, nặng hơn)

### Fail2ban
- [ ] Cài và config fail2ban
- [ ] Jail: ban IP sau 10 request 403 trong 1 phút
- [ ] Jail: ban IP sau 429 (rate limit hit) 5 lần
- [ ] Notify ban qua log

### Server hardening
- [ ] SSH: disable root login, dùng key only
- [ ] UFW firewall: chỉ mở port 22, 80, 443
- [ ] Disable unused services
- [ ] Auto security updates (unattended-upgrades)

---

## Security Flow (tổng thể)

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  CLOUDFLARE EDGE                        │
│  Check 1: TLS fingerprint (JA3/JA4)     │
│  Check 2: IP reputation / ASN           │
│  Check 3: Bot Fight Mode                │
│  Check 4: WAF rules (rate limit, etc.)  │
│  Check 5: Turnstile challenge nếu nghi  │
└────────────────────┬────────────────────┘
                     │ pass (chỉ CF IP)
                     ▼
┌─────────────────────────────────────────┐
│  NGINX (Dedicated Server)               │
│  Check 6: Chỉ accept từ CF IP ranges    │
│           → direct bypass → 444 (drop)  │
│  Check 7: Restore real IP từ            │
│           CF-Connecting-IP header       │
│  Check 8: Rate limit per real IP        │
│  Check 9: Block bad UA                  │
│  Check 10: Security headers             │
└────────────────────┬────────────────────┘
                     │ pass
                     ▼
┌─────────────────────────────────────────┐
│  BACKEND (Docker)                       │
│  Check 11: Verify Turnstile token       │
│  Check 12: CORS origin                  │
│  Check 13: Per-user rate limit (Redis)  │
└─────────────────────────────────────────┘
                     │
                     ▼
               Response JSON ✅

Direct bypass (không qua CF):
    curl https://YOUR_SERVER_IP/api/...
    → Nginx không có CF-Connecting-IP
    → UFW block port 443 cho non-CF IP → drop
```

---

## Thứ tự triển khai

```
Phase 1 — Foundation
  1. Setup server (SSH hardening, UFW, Docker)
  2. Backend API cơ bản + Dockerfile
  3. Frontend cơ bản + Dockerfile
  4. docker-compose chạy local OK

Phase 2 — Cloudflare setup
  5. Trỏ domain về Cloudflare
  6. Tạo Origin Certificate → cài Nginx
  7. SSL mode: Full (strict)
  8. Bật Bot Fight Mode
  9. WAF rules cơ bản

Phase 3 — Nginx + lock down
  10. Nginx reverse proxy config
  11. Whitelist Cloudflare IP ranges (UFW + nginx)
  12. Restore CF-Connecting-IP
  13. Security headers + rate limiting

Phase 4 — Anti-bot layer
  14. Turnstile tích hợp FE + BE verify
  15. Block bad UA
  16. Fail2ban setup

Phase 5 — Hardening & Test
  17. ModSecurity (optional)
  18. Script auto-update Cloudflare IP ranges
  19. Test bypass: curl direct IP → blocked
  20. Test bypass: curl_cffi → blocked tại CF WAF rule
  21. Test bypass: headless browser → Turnstile challenge
```

---

## Stack tóm tắt

| Layer | Component | Choice |
|-------|-----------|--------|
| Edge | CDN + WAF | Cloudflare (free) |
| Edge | Bot detection | Cloudflare Bot Fight Mode |
| Edge | Challenge | Cloudflare Turnstile (free) |
| Edge | TLS cert | Cloudflare Origin Certificate |
| Server | Reverse proxy | Nginx |
| Server | IP lock | UFW whitelist CF IP ranges |
| Server | WAF (optional) | ModSecurity + OWASP CRS |
| Server | IP banning | Fail2ban |
| App | Rate limiting | Nginx + Redis |
| App | Backend | Fastify (Node) hoặc FastAPI (Python) |
| App | Frontend | Next.js hoặc plain HTML |
| App | Container | Docker + docker-compose |
