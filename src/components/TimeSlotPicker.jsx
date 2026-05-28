import { useState, useEffect } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday,
  addMonths, subMonths, startOfDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Loader2 } from 'lucide-react'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const API_BASE = 'https://jens-booking-production.up.railway.app'

export default function TimeSlotPicker({
  selectedSlots = [],
  onToggleSlot,
  maxSlots = 1,
  label,
}) {
  const today = startOfDay(new Date())
  const [viewMonth, setViewMonth] = useState(startOfMonth(today))
  const [selectedDay, setSelectedDay] = useState(null)
  const [allSlots, setAllSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchSlots() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${API_BASE}/api/available-slots`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load slots')
        setAllSlots(data.slots.map(s => ({
          start: new Date(s.start),
          end: new Date(s.end),
        })))
      } catch (err) {
        setError('Could not load available times. Please refresh.')
      } finally {
        setLoading(false)
      }
    }
    fetchSlots()
  }, [])

  const slotsForDay = (day) =>
    allSlots.filter(s => isSameDay(s.start, day))

  const dayHasSlots = (day) => slotsForDay(day).length > 0

  const isSlotSelected = (slot) =>
    selectedSlots.some(s => s.getTime() === slot.start.getTime())

  const handleSlotClick = (slot) => {
    const isSelected = isSlotSelected(slot)
    onToggleSlot(slot.start, isSelected)
  }

  const canGoPrev = viewMonth.getTime() > startOfMonth(today).getTime()

  const calDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 }),
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading available times…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12 text-sm text-red-400">{error}</div>
    )
  }

  return (
    <div>
      {label && <p className="text-sm font-medium text-zinc-400 mb-4">{label}</p>}

      <div className="flex flex-col sm:flex-row gap-6">

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => { setViewMonth(m => subMonths(m, 1)); setSelectedDay(null) }}
              disabled={!canGoPrev}
              className="p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-zinc-200">
              {format(viewMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => { setViewMonth(m => addMonths(m, 1)); setSelectedDay(null) }}
              className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-zinc-600 py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {calDays.map(day => {
              const inMonth = isSameMonth(day, viewMonth)
              const hasSlots = dayHasSlots(day)
              const isSelected = selectedDay && isSameDay(day, selectedDay)
              const isTodayDay = isToday(day)

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => inMonth && hasSlots && setSelectedDay(day)}
                  disabled={!inMonth || !hasSlots}
                  className={[
                    'relative mx-auto flex items-center justify-center h-9 w-9 rounded-full text-sm font-medium transition-all duration-150',
                    !inMonth && 'invisible pointer-events-none',
                    isSelected && 'bg-indigo-600 text-white',
                    !isSelected && hasSlots && inMonth && 'text-zinc-100 hover:bg-zinc-800 cursor-pointer',
                    !hasSlots && inMonth && 'text-zinc-700 cursor-not-allowed',
                  ].filter(Boolean).join(' ')}
                >
                  {format(day, 'd')}
                  {isTodayDay && !isSelected && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="hidden sm:block w-px bg-zinc-800 self-stretch" />
        <div className="sm:hidden h-px bg-zinc-800" />

        <div className="w-full sm:w-40 shrink-0">
          {selectedDay ? (
            <>
              <p className="text-sm font-semibold text-zinc-200 mb-3">
                {format(selectedDay, 'EEE, MMM d')}
              </p>
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
                {slotsForDay(selectedDay).map(slot => {
                  const selected = isSlotSelected(slot)
                  const atMax = !selected && selectedSlots.length >= maxSlots

                  return (
                    <button
                      key={slot.start.toISOString()}
                      onClick={() => handleSlotClick(slot)}
                      disabled={atMax}
                      className={[
                        'w-full py-2.5 px-4 rounded-xl text-sm font-medium border transition-all duration-150',
                        selected
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                          : atMax
                          ? 'bg-zinc-900/40 border-zinc-800 text-zinc-600 cursor-not-allowed'
                          : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:border-indigo-500/50 hover:bg-zinc-700/60 cursor-pointer',
                      ].join(' ')}
                    >
                      {format(slot.start, 'HH:mm')}
                    </button>
                  )
                })}
              </div>
              {maxSlots > 1 && (
                <p className="text-xs text-zinc-500 mt-3">
                  {selectedSlots.length} / {maxSlots} selected
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-32 text-center">
              <div className="w-10 h-10 rounded-xl bg-zinc-800/60 flex items-center justify-center mb-3">
                <Clock size={18} className="text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-500 leading-snug">
                Select a day<br />to see times
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
