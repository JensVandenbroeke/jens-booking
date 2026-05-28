import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, Phone, FileText, Calendar, CheckCircle2, MessageCircle } from 'lucide-react'
import StepIndicator from '../components/StepIndicator'
import TimeSlotPicker from '../components/TimeSlotPicker'
import PhoneInput from '../components/PhoneInput'
import { format } from 'date-fns'

const STEPS = ['Your details', 'Pick a time', 'Confirm']

const LANGUAGES = [
  { id: 'nl', label: '🇳🇱 Nederlands' },
  { id: 'en', label: '🇬🇧 English' },
]

const initialForm = {
  name: '',
  email: '',
  phone: '',
  language: '',
  topic: 'Open Connection Call',
}

const LAST_STEP = STEPS.length - 1

export default function OpenConnectionFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [bookingResult, setBookingResult] = useState(null)

  const isConfirmStep = step === LAST_STEP

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
    setErrors((er) => ({ ...er, [e.target.name]: '' }))
  }

  const validateStep0 = () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Valid email required'
    if (!form.language) errs.language = 'Please select a language'
    return errs
  }

  const handleNext = () => {
    if (step === 0) {
      const errs = validateStep0()
      if (Object.keys(errs).length) { setErrors(errs); return }
    }
    if (step === 1 && !selectedSlot) return
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
          type: 'Open Connection Call',
          timeslot: selectedSlot.toISOString(),
          topic: form.topic,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')
      setBookingResult(data.booking)
      setStep((s) => s + 1)
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSlot = (date, isCurrentlySelected) => {
    setSelectedSlot(isCurrentlySelected ? null : date)
  }

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-80 h-80 bg-indigo-950/40 rounded-full blur-3xl -translate-y-1/2" />
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
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">Open Connection Call</h1>
          <p className="text-zinc-500 text-sm mt-1">15 min · Free · Video call</p>
        </div>

        <StepIndicator steps={STEPS} currentStep={isConfirmStep ? STEPS.length : step} />

        {step === 0 && (
          <div className="glass-card p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                <User size={13} className="inline mr-1.5 text-zinc-500" />
                Full name
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Your full name"
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
                WhatsApp number <span className="text-zinc-600 font-normal">(optional)</span>
              </label>
              <PhoneInput
                value={form.phone}
                onChange={(val) => setForm((f) => ({ ...f, phone: val }))}
                error={errors.phone}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Preferred language</label>
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
                          ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                          : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                      }`}
                    >
                      <span>{lang.label}</span>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-600'}`} />
                    </button>
                  )
                })}
              </div>
              {errors.language && <p className="text-red-400 text-xs mt-1">{errors.language}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                <FileText size={13} className="inline mr-1.5 text-zinc-500" />
                Topic / call title
              </label>
              <input
                name="topic"
                value={form.topic}
                onChange={handleChange}
                placeholder="Open Connection Call"
                className="input-field"
              />
              <p className="text-zinc-600 text-xs mt-1">Pre-filled — feel free to personalize</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="glass-card p-6">
            <TimeSlotPicker
              selectedSlots={selectedSlot ? [selectedSlot] : []}
              onToggleSlot={handleToggleSlot}
              maxSlots={1}
              label="Choose your preferred time"
            />
            {!selectedSlot && (
              <p className="text-xs text-zinc-600 mt-4">Select a slot to continue</p>
            )}
          </div>
        )}

        {isConfirmStep && (
          <div className="glass-card p-6 space-y-5">
            <h3 className="text-base font-semibold text-zinc-200">Booking summary</h3>
            <div className="space-y-3 text-sm">
              <Row icon={User} label="Name" value={form.name} />
              <Row icon={null} label="Email" value={form.email} />
              {form.phone && <Row icon={Phone} label="WhatsApp" value={form.phone} />}
              <Row icon={null} label="Language" value={LANGUAGES.find((l) => l.id === form.language)?.label ?? '—'} />
              <Row
                icon={Calendar}
                label="Time slot"
                value={selectedSlot ? format(selectedSlot, "EEEE, MMM d 'at' HH:mm") : '—'}
              />
              {form.topic && <Row icon={FileText} label="Topic" value={form.topic} />}
            </div>

            <div className="border-t border-zinc-800 pt-5 flex flex-col items-center text-center gap-3">
              <div className="p-3 rounded-full bg-emerald-600/15 text-emerald-400">
                <CheckCircle2 size={28} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-semibold text-zinc-100">Booking confirmed!</p>
                <p className="text-sm text-zinc-400 mt-1">
                  Your Open Connection Call has been submitted.
                </p>
                {bookingResult?.bookingNumber && (
                  <p className="text-xs text-zinc-600 mt-1">Booking #{bookingResult.bookingNumber}</p>
                )}
              </div>
              {bookingResult?.meetLink && (
                <a
                  href={bookingResult.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/40 text-blue-300 rounded-xl px-4 py-3 text-sm font-medium hover:bg-blue-600/30 transition-colors"
                >
                  🎥 Join Google Meet
                </a>
              )}
              <div className="flex items-start gap-2 bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 py-3 text-xs text-emerald-300 text-left w-full">
                <MessageCircle size={13} className="shrink-0 mt-0.5" />
                <span>
                  {form.phone
                    ? "You'll receive a WhatsApp confirmation shortly."
                    : "Check your email for confirmation details."}
                </span>
              </div>
              <button onClick={() => navigate('/')} className="btn-secondary w-full mt-1">
                Back to booking page
              </button>
            </div>
          </div>
        )}

        {!isConfirmStep && (
          <div className="flex flex-col gap-2 mt-6">
            <button
              onClick={step === 1 && selectedSlot ? handleConfirm : handleNext}
              disabled={(step === 1 && !selectedSlot) || loading}
              className="btn-primary w-full"
            >
              {loading ? 'Submitting…' : step === 1 && selectedSlot ? 'Confirm booking' : 'Continue'}
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

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500 flex items-center gap-1.5 shrink-0">
        {Icon && <Icon size={13} />}
        {label}
      </span>
      <span className="text-zinc-300 text-right">{value}</span>
    </div>
  )
}
