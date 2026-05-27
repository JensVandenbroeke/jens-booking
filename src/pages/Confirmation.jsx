import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Calendar, MessageCircle, ArrowLeft } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export default function Confirmation() {
  const { state } = useLocation()
  const navigate = useNavigate()

  const isCoaching = state?.type === 'Coaching Call'
  const slots = state?.slots?.map(parseISO) ?? []
  const slot = state?.slot ? parseISO(state.slot) : null

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-950/20 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md w-full">
        <div className="glass-card p-8 text-center">
          <div className="flex justify-center mb-5">
            <div className="p-4 rounded-full bg-emerald-600/15 text-emerald-400">
              <CheckCircle2 size={36} strokeWidth={1.5} />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight mb-2">
            {isCoaching ? 'Request submitted!' : 'Booking confirmed!'}
          </h1>
          <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
            {isCoaching
              ? 'Your preferred slots have been received. You\'ll get a WhatsApp message once the best time is confirmed.'
              : 'Your Open Connection Call is booked. A confirmation has been sent to your WhatsApp.'}
          </p>

          <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl p-4 text-left space-y-3 mb-6">
            <div className="flex items-center gap-3 text-sm">
              <Calendar size={15} className="text-zinc-500 shrink-0" />
              <span className="text-zinc-400">
                {isCoaching ? 'Requested slots' : 'Booked slot'}
              </span>
            </div>
            {isCoaching ? (
              <div className="space-y-1.5 pl-6">
                {slots.map((s, i) => (
                  <p key={i} className="text-zinc-300 text-sm">
                    {i + 1}. {format(s, "EEE, MMM d 'at' HH:mm")}
                  </p>
                ))}
              </div>
            ) : slot ? (
              <p className="text-zinc-300 text-sm pl-6">{format(slot, "EEEE, MMM d 'at' HH:mm")}</p>
            ) : null}

          </div>

          <div className="flex items-start gap-3 bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 text-left mb-8 text-sm text-emerald-300">
            <MessageCircle size={15} className="shrink-0 mt-0.5" />
            <span>
              {isCoaching
                ? 'Jens will send a WhatsApp message to confirm the final time once the overlap is found.'
                : 'We\'ll confirm your booking via WhatsApp shortly.'}
            </span>
          </div>

          <button
            onClick={() => navigate('/')}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <ArrowLeft size={15} />
            Back to booking page
          </button>
        </div>

        <p className="text-center text-zinc-600 text-xs mt-6">
          Questions? Send a message on WhatsApp.
        </p>
      </div>
    </div>
  )
}
