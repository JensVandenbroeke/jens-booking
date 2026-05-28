import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Search, Download, LogOut, Calendar, List, Phone, Mail, Globe, Tag } from 'lucide-react'

const API_BASE = 'https://jens-booking-production.up.railway.app'

export default function AdminPage() {
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '')
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [view, setView] = useState('table')
  const [selected, setSelected] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')

  useEffect(() => {
    if (token) fetchBookings()
  }, [token, filterStatus, filterType])

  async function fetchBookings() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.append('status', filterStatus)
      if (filterType) params.append('type', filterType)
      if (search) params.append('search', search)
      const res = await fetch(`${API_BASE}/api/admin/bookings?${params}`, {
        headers: { 'x-admin-token': token }
      })
      if (res.status === 401) { setAuthed(false); setToken(''); localStorage.removeItem('adminToken'); return }
      const data = await res.json()
      setBookings(data.bookings || [])
      setAuthed(true)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin() {
    setLoginError('')
    const res = await fetch(`${API_BASE}/api/admin/bookings`, {
      headers: { 'x-admin-token': password }
    })
    if (res.ok) {
      setToken(password)
      localStorage.setItem('adminToken', password)
      setAuthed(true)
      fetchBookings()
    } else {
      setLoginError('Incorrect password')
    }
  }

  async function handleChangePassword() {
    const res = await fetch(`${API_BASE}/api/admin/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ newPassword })
    })
    const data = await res.json()
    setPwMsg(data.message || data.error)
    setNewPassword('')
  }

  function handleExport() {
    window.open(`${API_BASE}/api/admin/bookings/export?token=${token}`, '_blank')
  }

  function handleLogout() {
    setToken('')
    localStorage.removeItem('adminToken')
    setAuthed(false)
    setBookings([])
  }

  const filtered = bookings.filter(b =>
    !search || b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.email?.toLowerCase().includes(search.toLowerCase())
  )

  const statusColor = (s) => s === 'confirmed' ? 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' : 'text-red-400 bg-red-900/30 border-red-700/40'

  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="glass-card p-8 w-full max-w-sm space-y-5">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Admin</h1>
            <p className="text-zinc-500 text-sm mt-1">Enter your password to continue</p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Password"
            className="input-field"
          />
          {loginError && <p className="text-red-400 text-xs">{loginError}</p>}
          <button onClick={handleLogin} className="btn-primary w-full">Sign in</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-10">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Bookings</h1>
            <p className="text-zinc-500 text-sm mt-1">{filtered.length} {filterStatus || 'total'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setView(v => v === 'table' ? 'calendar' : 'table')} className="btn-secondary flex items-center gap-2 text-sm">
              {view === 'table' ? <><Calendar size={14} /> Calendar</> : <><List size={14} /> Table</>}
            </button>
            <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={handleLogout} className="btn-secondary flex items-center gap-2 text-sm text-zinc-500">
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700 rounded-xl px-3 py-2 flex-1 min-w-48">
            <Search size={14} className="text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchBookings()}
              placeholder="Search name or email..."
              className="bg-transparent text-sm text-zinc-300 outline-none flex-1 placeholder-zinc-600"
            />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-field w-auto text-sm">
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input-field w-auto text-sm">
            <option value="">All types</option>
            <option value="Open Connection Call">Open Connection</option>
            <option value="1-on-1 Coaching">1-on-1 Coaching</option>
            <option value="Group Coaching">Group Coaching</option>
          </select>
        </div>

        {/* Table view */}
        {view === 'table' && (
          <div className="glass-card overflow-hidden">
            {loading ? (
              <div className="text-center py-16 text-zinc-500 text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-zinc-500 text-sm">No bookings found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">#</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Name</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Time</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Meet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => setSelected(b)}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-zinc-600">#{b.bookingNumber}</td>
                        <td className="px-4 py-3">
                          <p className="text-zinc-200 font-medium">{b.name}</p>
                          <p className="text-zinc-500 text-xs">{b.email}</p>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{b.type}</td>
                        <td className="px-4 py-3 text-zinc-400">
                          {b.timeslot ? format(new Date(b.timeslot), 'MMM d, HH:mm') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(b.status)}`}>
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {b.meetLink ? (
                            <a href={b.meetLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-400 hover:text-blue-300 text-xs">Join</a>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Calendar view */}
        {view === 'calendar' && (
          <div className="glass-card p-6">
            <p className="text-zinc-400 text-sm mb-4">Upcoming confirmed bookings</p>
            <div className="space-y-3">
              {filtered
                .filter(b => b.status === 'confirmed' && new Date(b.timeslot) > new Date())
                .sort((a, b) => new Date(a.timeslot) - new Date(b.timeslot))
                .map(b => (
                  <div
                    key={b.id}
                    onClick={() => setSelected(b)}
                    className="flex items-center gap-4 p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/50 hover:border-zinc-600 cursor-pointer transition-colors"
                  >
                    <div className="text-center min-w-12">
                      <p className="text-xs text-zinc-500">{format(new Date(b.timeslot), 'MMM')}</p>
                      <p className="text-2xl font-bold text-zinc-100">{format(new Date(b.timeslot), 'd')}</p>
                      <p className="text-xs text-zinc-500">{format(new Date(b.timeslot), 'HH:mm')}</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-zinc-200 font-medium">{b.name}</p>
                      <p className="text-zinc-500 text-xs">{b.type}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(b.status)}`}>{b.status}</span>
                  </div>
                ))}
              {filtered.filter(b => b.status === 'confirmed' && new Date(b.timeslot) > new Date()).length === 0 && (
                <p className="text-zinc-500 text-sm text-center py-8">No upcoming bookings</p>
              )}
            </div>
          </div>
        )}

        {/* Detail panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6" onClick={() => setSelected(null)}>
            <div className="glass-card p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-100">Booking #{selected.bookingNumber}</h2>
                <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
              </div>
              <div className="space-y-3 text-sm">
                <Detail icon={Tag} label="Type" value={selected.type} />
                <Detail icon={Calendar} label="Time" value={selected.timeslot ? format(new Date(selected.timeslot), "EEEE, MMM d 'at' HH:mm") : '—'} />
                <Detail icon={null} label="Name" value={selected.name} />
                <Detail icon={Mail} label="Email" value={selected.email} />
                {selected.whatsapp && <Detail icon={Phone} label="WhatsApp" value={selected.whatsapp} />}
                {selected.language && <Detail icon={Globe} label="Language" value={selected.language} />}
                {selected.topic && <Detail icon={null} label="Topic" value={selected.topic} />}
                {selected.goals && <Detail icon={null} label="Goals" value={selected.goals} />}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(selected.status)}`}>{selected.status}</span>
                </div>
                {selected.meetLink && (
                  <a href={selected.meetLink} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 text-blue-300 rounded-xl px-4 py-3 text-sm font-medium hover:bg-blue-600/30 transition-colors w-full">
                    🎥 Join Google Meet
                  </a>
                )}
              </div>
              <p className="text-xs text-zinc-600">Booked {selected.createdAt ? format(new Date(selected.createdAt), 'MMM d, yyyy HH:mm') : '—'}</p>
            </div>
          </div>
        )}

        {/* Change password */}
        <div className="mt-12 glass-card p-6 max-w-sm">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Change admin password</h3>
          <div className="flex gap-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="input-field flex-1 text-sm"
            />
            <button onClick={handleChangePassword} className="btn-secondary text-sm px-4">Save</button>
          </div>
          {pwMsg && <p className="text-xs text-zinc-500 mt-2">{pwMsg}</p>}
        </div>

      </div>
    </div>
  )
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500 flex items-center gap-1.5 shrink-0">
        {Icon && <Icon size={12} />}
        {label}
      </span>
      <span className="text-zinc-300 text-right text-xs">{value}</span>
    </div>
  )
}
