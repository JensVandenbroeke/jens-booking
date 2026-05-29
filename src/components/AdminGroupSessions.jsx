import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Plus, Copy, CheckCircle2, Users, Link2, X } from 'lucide-react'

const API_BASE = 'https://jens-booking-production.up.railway.app'

export default function AdminGroupSessions({ token }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [guestCount, setGuestCount] = useState(2)
  const [confirmSlot, setConfirmSlot] = useState('')
  const [copied, setCopied] = useState('')
  const [msg, setMsg] = useState('')

  const headers = { 'x-admin-token': token, 'Content-Type': 'application/json' }

  async function fetchSessions() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/admin/group-sessions`, { headers })
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function fetchDetail(id) {
    const res = await fetch(`${API_BASE}/api/admin/group-sessions/${id}`, { headers })
    const data = await res.json()
    setDetail(data)
    setSelected(id)
    if (data.overlaps?.full?.[0]) {
      setConfirmSlot(data.overlaps.full[0].slot)
    }
  }

  useEffect(() => {
    if (token) fetchSessions()
  }, [token])

  async function handleCreate(e) {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/api/admin/group-sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: newTitle || `${guestCount + 1}-way call`,
        sessionType: guestCount >= 3 ? '4way' : '3way',
        expectedParticipants: guestCount,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setCreating(false)
      setNewTitle('')
      fetchSessions()
      if (data.session?.id) fetchDetail(data.session.id)
      copyText(data.session.shareUrl, 'created')
    }
  }

  function copyText(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  async function handleConfirm() {
    if (!confirmSlot) return
    const res = await fetch(`${API_BASE}/api/admin/group-sessions/${selected}/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ finalTimeslot: confirmSlot }),
    })
    const data = await res.json()
    if (res.ok) {
      setMsg('Call confirmed and emails sent.')
      fetchDetail(selected)
      fetchSessions()
    } else {
      setMsg(data.error || 'Failed')
    }
  }

  const statusStyle = (s) => {
    if (s === 'confirmed') return 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'
    if (s === 'cancelled') return 'text-red-400 bg-red-900/30 border-red-700/40'
    return 'text-amber-400 bg-amber-900/30 border-amber-700/40'
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Group scheduling</h2>
          <p className="text-zinc-500 text-sm">Create a link for WhatsApp groups — see who picked which slots</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary flex items-center gap-2 text-sm py-2.5">
          <Plus size={16} /> New group link
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="glass-card p-5 mb-6 space-y-4">
          <h3 className="text-sm font-medium text-zinc-300">New scheduling link</h3>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title (e.g. Coaching with Maria & Tom)"
            className="input-field text-sm"
          />
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Guests (excluding you)</label>
            <div className="flex gap-2">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGuestCount(n)}
                  className={`flex-1 py-2 rounded-xl text-sm border ${guestCount === n ? 'border-violet-500 bg-violet-900/20 text-violet-300' : 'border-zinc-700 text-zinc-400'}`}
                >
                  {n} guests ({n + 1}-way)
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 text-sm">Create & copy link</button>
            <button type="button" onClick={() => setCreating(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">No group sessions yet. Create a link to paste in WhatsApp.</p>
      ) : (
        <div className="glass-card overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Title</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Responses</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Overlaps</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => fetchDetail(s.id)}
                  className={`border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/30 ${selected === s.id ? 'bg-zinc-800/40' : ''}`}
                >
                  <td className="px-4 py-3 text-zinc-200">{s.title}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {s.respondedCount} / {s.expectedParticipants}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{s.overlapCount || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusStyle(s.status)}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {s.createdAt ? format(new Date(s.createdAt), 'MMM d, HH:mm') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-zinc-100">{detail.session.title}</h3>
              <p className="text-xs text-zinc-500 mt-1">
                {detail.session.sessionType} · {detail.participants?.length || 0} / {detail.session.expectedParticipants} responded
              </p>
            </div>
            <button onClick={() => { setDetail(null); setSelected(null) }} className="text-zinc-500 hover:text-zinc-300">
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyText(detail.shareUrl, 'link')}
              className="btn-secondary text-xs flex items-center gap-1.5 py-2"
            >
              {copied === 'link' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              Copy WhatsApp link
            </button>
            <a href={detail.shareUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs flex items-center gap-1.5 py-2">
              <Link2 size={12} /> Open page
            </a>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Users size={12} /> Who picked what
            </p>
            {detail.participants?.length === 0 ? (
              <p className="text-sm text-zinc-600">No responses yet — paste the link in your WhatsApp group.</p>
            ) : (
              <div className="space-y-3">
                {detail.participants.map((p) => (
                  <div key={p.email} className="bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/50">
                    <p className="text-zinc-200 font-medium text-sm">{p.name}</p>
                    <p className="text-zinc-500 text-xs">{p.email}</p>
                    <p className="text-zinc-400 text-xs mt-2">
                      {p.slots?.length
                        ? p.slots.map((s) => format(new Date(s.slotStart), 'EEE d MMM, HH:mm')).join(' · ')
                        : 'No slots'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {detail.overlaps?.full?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-emerald-500/80 uppercase tracking-wider mb-2">Times everyone can do</p>
              <div className="space-y-1.5">
                {detail.overlaps.full.map((o) => (
                  <button
                    key={o.slot}
                    type="button"
                    onClick={() => setConfirmSlot(o.slot)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                      confirmSlot === o.slot
                        ? 'border-emerald-500 bg-emerald-900/20 text-emerald-300'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {format(new Date(o.slot), "EEEE, MMM d 'at' HH:mm")} (Lisbon)
                  </button>
                ))}
              </div>
            </div>
          )}

          {detail.overlaps?.partial?.length > 0 && detail.overlaps.full?.length === 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-2">Partial overlaps (not everyone yet):</p>
              {detail.overlaps.partial.slice(0, 5).map((o) => (
                <p key={o.slot} className="text-xs text-zinc-600">
                  {format(new Date(o.slot), 'MMM d HH:mm')} — {o.matchCount} people
                </p>
              ))}
            </div>
          )}

          {detail.session.status === 'collecting' && (
            <div className="border-t border-zinc-800 pt-4 space-y-3">
              <label className="block text-xs text-zinc-500">Confirm final time (ISO or pick overlap above)</label>
              <input
                value={confirmSlot}
                onChange={(e) => setConfirmSlot(e.target.value)}
                className="input-field text-sm"
                placeholder="2026-05-30T14:00:00.000Z"
              />
              <button onClick={handleConfirm} className="btn-primary w-full text-sm">
                Confirm call & send emails
              </button>
            </div>
          )}

          {detail.session.status === 'confirmed' && detail.session.finalTimeslot && (
            <p className="text-sm text-emerald-400">
              Confirmed: {format(new Date(detail.session.finalTimeslot), "EEEE, MMM d 'at' HH:mm")}
              {detail.session.meetLink && (
                <a href={detail.session.meetLink} className="block text-blue-400 mt-1 text-xs" target="_blank" rel="noopener noreferrer">
                  Meet link
                </a>
              )}
            </p>
          )}

          {msg && <p className="text-xs text-zinc-500">{msg}</p>}
        </div>
      )}
    </div>
  )
}
