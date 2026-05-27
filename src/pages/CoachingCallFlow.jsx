import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, Phone, Users, Plus, X, Calendar, CheckCircle2, Info, MessageCircle } from 'lucide-react'
import StepIndicator from '../components/StepIndicator'
import TimeSlotPicker from '../components/TimeSlotPicker'
import { format } from 'date-fns'

const STEPS = ['Session type', 'Your details', 'Time preferences', 'Confirm']

const SESSION_TYPES = [
  {
    id: '1on1',
    label: '1-on-1 Coaching',
    description: 'A private session focused entirely on you.',
    icon: User,
  },
  {
    id: 'group',
    label: 'Group Coaching',
    description: 'A shared session — all participants submit slots, best overlap wins.',
    icon: Users,
  },
]

const LANGUAGES = [
  { id: 'nl', label: '🇳🇱 Nederlands' },
  { id: 'en', label: '🇬🇧 English' },
]

const initialForm = {
  name: '',
  email: '',
  phone: '',
  language: '',
  goals: '',
  participants: [],
  newParticipantEmail: '',
}

const LAST_STEP = STEPS.length - 1

export default function CoachingCallFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [sessionType, setSessionType] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [selectedSlots, setSelectedSlots] = useState([])
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const maxSlots = sessionType === '1on1' ? 1 : 3
  const isConfirmStep = step === LAST_STEP

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
    setErrors((er) => ({ ...er, [e.target.name]: '' }))
  }

  const addParticipant = () => {
    const email = form.newParticipantEmail.trim()
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setErrors((er) => ({ ...er, newParticipantEmail: 'Valid email required' }))
      return
    }
    if (form.participants.includes(email)) {
      setErrors((er) => ({ ...er, newParticipantEmail: 'Already added' }))
      return
    }
    setForm((f) => ({ ...f, participants: [...f.participants, email], newParticipantEmail: '' }))
    setErrors((er) => ({ ...er, newParticipantEmail: '' }))
  }

  const removeParticipant = (email) => {
    setForm((f) => ({ ...f, participants: f.participants.filter((p) => p !== email) }))
  }

  const validateStep1 = () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Valid email required'
    if (!form.phone.trim()) errs.phone = 'WhatsApp number is required'
    if (!form.language) errs.language = 'Please select a language'
    return errs
  }

  const handleNext = () => {
    if (step === 0 && !sessionType) return
    if (step === 1) {
      const errs = validateStep1()
      if (Object.keys(errs).length) { setErrors(errs); return }
    }
    if (step === 2 && selectedSlots.length < maxSlots) return
    setStep((s) => s + 1)
  }

  const handleConfirm = async () => {
    setLoading(true)
    setSubmitError('')
    try {
      const res = await fetch('https://jens-booking-production.up.railway.app/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          whatsapp: form.phone,
          language: LANGUAGES.find((l) => l.id === form.language)?.label ?? form.language,
          type: sessionType === '1on1' ? '1-on-1 Coaching' : 'Group Coaching',
          timeslot: selectedSlots.map((s) => format(s, "yyyy-MM-dd HH:mm")).join(' / '),
          goals: form.goals,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')
      setStep((s) => s + 1)
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSlot = (date, isCurrentlySelected) => {
    if (isCurrentlySelected) {
      setSelectedSlots((slots) => slots.filter((s) => s.getTime() !== date.getTime()))
    } else if (selectedSlots.length < maxSlots) {
      setSelectedSlots((slots) => [...slots, date].sort((a, b) => a - b))
    }
  }

  const canProceed = () => {
    if (step === 0) return !!sessionType
    if (step === 2) return selectedSlots.length >= maxSlots
    return true
  }

  const slotsReady = selectedSlots.length >= maxSlots

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/3 w-80 h-80 bg-violet-950/40 rounded-full blur-3xl -translate-y-1/2" />
      </div>

      <div className="relative max-w-xl mx-auto px-6 py-12">
        {!isConfirmStep && (
          <button
            onClick={() => (step > 0 ? setStep((s) => s - 1) : navigate('/'))}
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm font-medium mb-8 transition-colors"
          >
            <ArrowLeft size={16} />
            {step > 0 ? 'Back' : 'All call types'}
          </button>
        )}

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">Coaching Call</h1>
          <p className="text-zinc-500 text-sm mt-1">
            1-on-1 or group &bull; Submit preferred time slots
          </p>
        </div>

        <StepIndicator steps={STEPS} currentStep={isConfirmStep ? STEPS.length : step} />

        {/* Step 0: Session type */}
        {step === 0 && (
          <div className="space-y-3">
            {SESSION_TYPES.map((type) => {
              const Icon = type.icon
              const isSelected = sessionType === type.id
              return (
                <button
                  key={type.id}
                  onClick={() => {
                    setSessionType(type.id)
                    setSelectedSlots([])
                  }}
                  className={`w-full glass-card p-5 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                    isSelected ? 'border-violet-500 bg-violet-900/10' : 'hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-2.5 rounded-xl ${
                        isSelected ? 'bg-violet-600/20 text-violet-400' : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      <Icon size={20} strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${isSelected ? 'text-violet-300' : 'text-zinc-200'}`}>
                        {type.label}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">{type.description}</p>
                    </div>
                    <div
                      className={`ml-auto w-4 h-4 rounded-full border-2 shrink-0 transition-all ${
                        isSelected ? 'border-violet-500 bg-violet-500' : 'border-zinc-600'
                      }`}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Step 1: Details */}
        {step === 1 && (
          <div className="glass-card p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Full name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Jens Vandenbroeke"
                className="input-field"
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email address</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className="input-field"
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                <Phone size={13} className="inline mr-1.5 text-zinc-500" />
                WhatsApp number
              </label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="+32 470 000 000"
                className="input-field"
              />
              {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Preferred language
              </label>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map((lang) => {
                  const isSelected = form.language === lang.id
                  return (
                    <button
                      key={lang.id}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, language: lang.id }))
                        setErrors((er) => ({ ...er, language: '' }))
                      }}
                      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${
                        isSelected
                          ? 'bg-violet-600/15 border-violet-500 text-violet-300'
                          : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      }`}
                    >
                      <span>{lang.label}</span>
                      <span
                        className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all ${
                          isSelected ? 'border-violet-500 bg-violet-500' : 'border-zinc-600'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              {errors.language && <p className="text-red-400 text-xs mt-1">{errors.language}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Goals for this session{' '}
                <span className="text-zinc-600 font-normal">(optional)</span>
              </label>
              <textarea
                name="goals"
                value={form.goals}
                onChange={handleChange}
                placeholder="What do you want to achieve or work through?"
                rows={3}
                className="input-field resize-none"
              />
            </div>

            {sessionType === 'group' && (
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  <Users size={13} className="inline mr-1.5 text-zinc-500" />
                  Other participants{' '}
                  <span className="text-zinc-600 font-normal">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    name="newParticipantEmail"
                    value={form.newParticipantEmail}
                    onChange={handleChange}
                    placeholder="participant@email.com"
                    className="input-field"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addParticipant())}
                  />
                  <button
                    onClick={addParticipant}
                    className="btn-secondary shrink-0 px-3 py-3"
                    title="Add participant"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {errors.newParticipantEmail && (
                  <p className="text-red-400 text-xs mt-1">{errors.newParticipantEmail}</p>
                )}
                {form.participants.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {form.participants.map((p) => (
                      <div
                        key={p}
                        className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm text-zinc-300"
                      >
                        <span>{p}</span>
                        <button
                          onClick={() => removeParticipant(p)}
                          className="text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {form.participants.length > 0 && (
                  <p className="text-xs text-zinc-600 mt-2 flex items-center gap-1">
                    <Info size={11} />
                    Each participant will receive a link to submit their own preferred slots.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Time slots */}
        {step === 2 && (
          <div className="glass-card p-6">
            <div className="flex items-start gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl px-4 py-3 mb-5 text-xs text-zinc-400">
              <Info size={13} className="shrink-0 mt-0.5 text-violet-400" />
              <span>
                {sessionType === '1on1' ? (
                  <>Select <strong className="text-zinc-300">1 preferred time slot</strong>. Jens will confirm via WhatsApp.</>
                ) : (
                  <>Select <strong className="text-zinc-300">3 preferred time slots</strong>. The system will find the best overlap across all participants and confirm via WhatsApp.</>
                )}
              </span>
            </div>
            <TimeSlotPicker
              selectedSlots={selectedSlots}
              onToggleSlot={handleToggleSlot}
              maxSlots={maxSlots}
              label={sessionType === '1on1' ? 'Pick your preferred slot' : 'Pick 3 preferred slots'}
            />
          </div>
        )}

        {/* Step 3: Summary + auto success */}
        {isConfirmStep && (
          <div className="glass-card p-6 space-y-5">
            <h3 className="text-base font-semibold text-zinc-200">Booking summary</h3>
            <div className="space-y-3 text-sm">
              <Row label="Session type" value={sessionType === '1on1' ? '1-on-1 Coaching' : 'Group Coaching'} />
              <Row label="Name" value={form.name} />
              <Row label="Email" value={form.email} />
              <Row label="WhatsApp" value={form.phone} />
              <Row label="Language" value={LANGUAGES.find((l) => l.id === form.language)?.label ?? '—'} />
              {form.goals && <Row label="Goals" value={form.goals} />}
              {sessionType === 'group' && form.participants.length > 0 && (
                <Row label="Participants" value={form.participants.join(', ')} />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                {sessionType === '1on1' ? 'Preferred slot' : 'Preferred slots'}
              </p>
              {selectedSlots.map((slot, i) => (
                <div
                  key={slot.toISOString()}
                  className="flex items-center gap-3 bg-zinc-800/60 rounded-xl px-4 py-2.5 text-sm"
                >
                  {sessionType === 'group' && (
                    <span className="w-5 h-5 rounded-full bg-violet-600/20 border border-violet-600/40 text-violet-400 text-xs flex items-center justify-center font-semibold shrink-0">
                      {i + 1}
                    </span>
                  )}
                  <Calendar size={14} className="text-zinc-500 shrink-0" />
                  <span className="text-zinc-300">
                    {format(slot, "EEEE, MMM d 'at' HH:mm")}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800 pt-5 flex flex-col items-center text-center gap-3">
              <div className="p-3 rounded-full bg-emerald-600/15 text-emerald-400">
                <CheckCircle2 size={28} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-semibold text-zinc-100">Request submitted!</p>
                <p className="text-sm text-zinc-400 mt-1">
                  {sessionType === 'group'
                    ? 'All participants will receive a link to submit their slots.'
                    : 'Jens will review your slot and get back to you shortly.'}
                </p>
              </div>
              <div className="flex items-start gap-2 bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 py-3 text-xs text-emerald-300 text-left w-full">
                <MessageCircle size={13} className="shrink-0 mt-0.5" />
                <span>We'll confirm your booking via WhatsApp shortly.</span>
              </div>
              <button
                onClick={() => navigate('/')}
                className="btn-secondary w-full mt-1"
              >
                Back to booking page
              </button>
            </div>
          </div>
        )}

        {!isConfirmStep && (
          <div className="flex flex-col gap-2 mt-6">
            <button
              onClick={step === 2 && slotsReady ? handleConfirm : handleNext}
              disabled={!canProceed() || loading}
              className="btn-primary w-full"
            >
              {loading
                ? 'Submitting…'
                : step === 2 && slotsReady
                ? 'Confirm booking'
                : step === 2
                ? `Select ${maxSlots - selectedSlots.length} more slot${maxSlots - selectedSlots.length !== 1 ? 's' : ''}`
                : 'Continue'}
            </button>
            {submitError && (
              <p className="text-red-400 text-xs text-center">{submitError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className="text-zinc-300 text-right">{value}</span>
    </div>
  )
}
