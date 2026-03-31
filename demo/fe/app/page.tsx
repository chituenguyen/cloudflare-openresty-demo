'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window { turnstile: any }
}

const API = process.env.NEXT_PUBLIC_API_URL
const TOKEN_KEY = 'api.access.token'
const TOKEN_EXP_KEY = 'api.access.expire'
const REFRESH_BEFORE = 5 * 60 * 1000 // refresh khi còn < 5 phút

function getStoredToken() {
  const token = localStorage.getItem(TOKEN_KEY)
  const exp = parseInt(localStorage.getItem(TOKEN_EXP_KEY) || '0')
  if (!token || Date.now() >= exp) return null
  return { token, exp }
}

function saveToken(token: string, expiresIn: number) {
  const exp = Date.now() + expiresIn * 1000
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_EXP_KEY, String(exp))
  return exp
}

async function exchangeToken(turnstileToken: string): Promise<string> {
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstileToken }),
  })
  if (!res.ok) throw new Error('Token exchange failed')
  const data = await res.json()
  saveToken(data.token, data.expiresIn)
  return data.token
}

async function fetchData(token: string) {
  const res = await fetch(`${API}/api/v1/data`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

function runTurnstile(container: HTMLElement): Promise<string> {
  return new Promise((resolve, reject) => {
    window.turnstile.render(container, {
      sitekey: '0x4AAAAAACyZrJBXCa_xSjxb',
      callback: resolve,
      'error-callback': () => reject(new Error('Turnstile failed')),
    })
  })
}

export default function Home() {
  const [data, setData] = useState<object | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const widgetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.onload = () => init()
    document.body.appendChild(script)
  }, [])

  async function init() {
    try {
      const stored = getStoredToken()
      let token: string

      if (stored) {
        token = stored.token
        const remaining = stored.exp - Date.now()

        // Còn < 5 phút → silent refresh background
        if (remaining < REFRESH_BEFORE) {
          silentRefresh()
        }
      } else {
        // Chưa có token → verify Turnstile rồi lấy JWT
        const turnstileToken = await runTurnstile(widgetRef.current!)
        token = await exchangeToken(turnstileToken)
      }

      const result = await fetchData(token)
      setData(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function silentRefresh() {
    try {
      // Reset widget cũ, chạy lại background
      if (widgetRef.current) widgetRef.current.innerHTML = ''
      const turnstileToken = await runTurnstile(widgetRef.current!)
      await exchangeToken(turnstileToken)
    } catch {
      // Silent fail — token cũ vẫn dùng được cho đến khi hết hạn
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 className="text-xl font-mono mb-6 text-green-400">API Response</h1>
      <div ref={widgetRef} className="mb-4" />
      {loading && <p className="font-mono text-gray-400">Loading...</p>}
      {error && <p className="font-mono text-red-400">Error: {error}</p>}
      {data && (
        <pre className="bg-gray-900 rounded-lg p-6 text-sm font-mono overflow-auto border border-gray-800">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </main>
  )
}
