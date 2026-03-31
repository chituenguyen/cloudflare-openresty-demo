const fastify = require('fastify')({ logger: true })
const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod'
const JWT_TTL = 30 * 60 // 30 phút (seconds)

fastify.register(require('@fastify/cors'), {
  origin: ['https://blog360.org'],
  methods: ['GET', 'POST'],
})

async function verifyTurnstile(token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  })
  const data = await res.json()
  return data.success === true
}

// Turnstile verify → issue JWT
fastify.post('/auth/token', async (request, reply) => {
  const token = request.body?.turnstileToken
  if (!token) return reply.code(400).send({ error: 'Missing turnstileToken' })

  const ip = request.headers['x-real-ip'] || request.ip
  const valid = await verifyTurnstile(token, ip)
  if (!valid) return reply.code(403).send({ error: 'Turnstile failed' })

  const accessToken = jwt.sign({ ip }, JWT_SECRET, { expiresIn: JWT_TTL })
  return { token: accessToken, expiresIn: JWT_TTL }
})

// Data routes — JWT đã được verify ở OpenResty gateway
fastify.get('/api/v1/data', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    data: [
      { id: 1, name: 'Item A', value: 42 },
      { id: 2, name: 'Item B', value: 87 },
      { id: 3, name: 'Item C', value: 13 },
    ]
  }
})

fastify.get('/health', async (request, reply) => {
  return { status: 'ok' }
})

fastify.listen({ port: 3001, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})
