import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Users, CheckCircle2, Link2, Copy, Loader2, Pencil } from 'lucide-react'
import TimeSlotPicker from '../components/TimeSlotPicker'
import PhoneInput from '../components/PhoneInput'

const API_BASE = 'https://jens-booking-production.up.railway.app'

export default function GroupSchedulePage() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessionData, setSessionData] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [selectedSlots, setSelectedSlots] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  const minSlots = sessionData?.minSlots ?? 3
  const maxSlots = sessionData?.maxSlots ?? 5

  const applyMySubmission = useCallback((data) => {
    if (!data?.mySubmission) return
    setName(data.mySubmission.name || '')
    setEmail(data.mySubmission.email || '')
    setPhone(data.mySubmission.whatsapp || '')
    setSelectedSlots(
      (data.mySubmission.slots || []).map((s) => new Date(s)).filter((d) => !Number.isNaN(d.getTime()))
    )
  }, [])

  const loadSession = useCallback(async (emailFilter) => {
    setLoading(true)
    setError('')
    try {
      const q = emailFilter ? `?email=${encodeURIComponent(emailFilter)}` : ''
      const res = await fetch(`${API_BASE}/api/group/${token}${q}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setSessionData(data)
      if (emailFilter && data.mySubmission) {
        applyMySubmission(data)
        setDone(true)
      }
    } catch (err) {
      setError(err.message || 'This link is invalid or expired.')
    } finally {
      setLoading(false)
    }
  }, [token, applyMySubmission])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  const handleToggleSlot = (date, isCurrentlySelected) => {
    if (isCurrentlySelected) {
      setSelectedSlots((slots) => slots.filter((s) => s.getTime() !== date.getTime()))
    } else if (selectedSlots.length < maxSlots) {
      setSelectedSlots((slots) => [...slots, date].sort((a, b) => a - b))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || selectedSlots.length < minSlots) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch(`${API_BASE}/api/group/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          whatsapp: phone,
          slots: selectedSlots.map((s) => s.toISOString()),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submit failed')
      setDone(true)
      setEditing(false)
      loadSession(email.trim())
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = () => {
    if (sessionData?.shareUrl) {
      navigator.clipboard.writeText(sessionData.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading && !sessionData) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <p className="text-red-400 text-sm text-center">{error}</p>
      </div>
    )
  }

  const { session, jensSlots, otherParticipants, othersBySlot, respondedCount, shareUrl, yourOrder } = sessionData
  const isConfirmed = session.status === 'confirmed'
  const showForm = !done || editing

  if (isConfirmed) {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-12">
        <div className="max-w-md mx-auto glass-card p-8 text-center space-y-4">
          <CheckCircle2 className="mx-auto text-emerald-400" size={40} />
          <h1 className="text-xl font-bold text-zinc-100">{session.title}</h1>
          <p className="text-zinc-400 text-sm">This call is scheduled</p>
          {session.finalTimeslot && (
            <p className="text-zinc-200 font-medium">
              {format(new Date(session.finalTimeslot), "EEEE, MMM d 'at' HH:mm")} (Lisbon)
            </p>
          )}
          {session.meetLink && (
            <a href={session.meetLink} target="_blank" rel="noopener noreferrer" className="btn-primary inline-block w-full">
              Join Google Meet
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden px-6 py-10">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-72 h-72 bg-violet-950/40 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-xl mx-auto">
        <div className="mb-8">
          <p className="text-violet-400 text-xs font-medium uppercase tracking-wider mb-1">Group scheduling</p>
          <h1 className="text-2xl font-bold text-zinc-50">{session.title}</h1>
          <p className="text-zinc-500 text-sm mt-2">
            Pick <strong className="text-zinc-400">{minSlots}–{maxSlots}</strong> times when you are free on Jens&apos;s calendar.
            {respondedCount > 0 && (
              <> {respondedCount} of {session.expectedParticipants} guests have responded.</>
            )}
          </p>
          {yourOrder && yourOrder <= respondedCount && (
            <p className="text-xs text-violet-400/80 mt-2">
              You are guest #{yourOrder} in this group (by response order).
            </p>
          )}
        </div>

        {otherParticipants.length > 0 && (
          <div className="glass-card p-4 mb-6 border-emerald-900/30">
            <div className="flex items-start gap-2">
              <Users size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-sm w-full">
                <p className="text-emerald-300/90 font-medium mb-2">
                  Times others already picked (on Jens&apos;s calendar):
                </p>
                <ul className="space-y-2">
                  {otherParticipants.map((p) => (
                    <li key={p.name + p.order} className="text-zinc-400">
                      <span className="text-zinc-300">Guest {p.order} — {p.name}</span>
                      <span className="block text-xs mt-0.5 text-zinc-500">
                        {p.slots.map((s) => format(new Date(s.start), 'EEE d MMM, HH:mm')).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-500 mt-3">
                  Green slots in the calendar are times someone else already chose. Pick any of Jens&apos;s open times — overlapping choices make scheduling easier.
                </p>
              </div>
            </div>
          </div>
        )}

        {done && !editing ? (
          <div className="glass-card p-8 text-center space-y-4">
            <CheckCircle2 className="mx-auto text-emerald-400" size={36} />
            <h2 className="text-lg font-semibold text-zinc-100">Thanks, {name}!</h2>
            <p className="text-zinc-400 text-sm">
              Your {selectedSlots.length} slots are saved. You can update them anytime with the same email.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
            >
              <Pencil size={14} /> Update my times
            </button>
            <button type="button" onClick={copyLink} className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy link for the group'}
            </button>
          </div>
        ) : showForm && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="glass-card p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => email.trim() && loadSession(email.trim())}
                  className="input-field"
                  required
                />
                <p className="text-xs text-zinc-600 mt-1">Use the same email when you come back to edit your slots.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">WhatsApp (optional)</label>
                <PhoneInput value={phone} onChange={setPhone} />
              </div>
            </div>

            <div className="glass-card p-6">
              <TimeSlotPicker
                slots={jensSlots}
                othersBySlot={othersBySlot || {}}
                showGroupLegend={otherParticipants.length > 0 || respondedCount > 0}
                selectedSlots={selectedSlots}
                onToggleSlot={handleToggleSlot}
                maxSlots={maxSlots}
                label="Jens's Calls calendar — pick your times"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || selectedSlots.length < minSlots || !name.trim() || !email.trim()}
              className="btn-primary w-full"
            >
              {submitting
                ? 'Saving…'
                : selectedSlots.length < minSlots
                ? `Select ${minSlots - selectedSlots.length} more slot${minSlots - selectedSlots.length !== 1 ? 's' : ''}`
                : `Save ${selectedSlots.length} time slots`}
            </button>
            {submitError && <p className="text-red-400 text-xs text-center">{submitError}</p>}
          </form>
        )}

        {shareUrl && (
          <p className="text-center text-xs text-zinc-600 mt-6 flex items-center justify-center gap-1">
            <Link2 size={12} />
            One link per call — share only this link in your WhatsApp group
          </p>
        )}
      </div>
    </div>
  )
}
