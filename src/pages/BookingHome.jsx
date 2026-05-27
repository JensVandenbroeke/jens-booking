import { useNavigate } from 'react-router-dom'
import { Clock, Users, Calendar, ArrowRight, Zap, Video, Shield } from 'lucide-react'
import profilePhoto from '../assets/fotoshoot bahama\'s .jpg'

const callTypes = [
  {
    id: 'open-connection',
    label: 'Open Connection Call',
    tagline: 'Let\'s get to know each other',
    description:
      'A free, low-pressure introductory call. We\'ll explore what your goals are, what you need, and whether there\'s a fit.',
    duration: '15 min',
    blockDuration: '30 min calendar block',
    icon: Zap,
    accent: 'indigo',
    features: ['1-on-1 call', 'Free of charge', 'WhatsApp confirmation'],
    path: '/open-connection',
  },
  {
    id: 'coaching-call',
    label: 'Coaching Call',
    tagline: '1-on-1 or group session',
    description:
      'A focused coaching session tailored to your goals. Submit 3 preferred time slots and we find what works for all parties.',
    duration: 'Flexible duration',
    blockDuration: 'Overlap-matched scheduling',
    icon: Users,
    accent: 'violet',
    features: ['1-on-1 or group', 'Smart time-matching', 'WhatsApp confirmation'],
    path: '/coaching-call',
  },
]

function AccentDot({ color }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${
        color === 'indigo' ? 'bg-indigo-400' : 'bg-violet-400'
      }`}
    />
  )
}

function CallTypeCard({ type, onSelect }) {
  const Icon = type.icon
  const isIndigo = type.accent === 'indigo'

  return (
    <button
      onClick={() => onSelect(type.path)}
      className="group glass-card p-8 text-left w-full hover:border-zinc-700 transition-all duration-300 hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5 cursor-pointer"
    >
      <div className="flex items-start justify-between mb-6">
        <div
          className={`p-3 rounded-xl ${
            isIndigo ? 'bg-indigo-600/15 text-indigo-400' : 'bg-violet-600/15 text-violet-400'
          }`}
        >
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <ArrowRight
          size={18}
          className="text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-200 mt-1"
        />
      </div>

      <h2 className="text-xl font-semibold text-zinc-50 mb-1 tracking-tight">{type.label}</h2>
      <p className={`text-sm font-medium mb-3 ${isIndigo ? 'text-indigo-400' : 'text-violet-400'}`}>
        {type.tagline}
      </p>
      <p className="text-zinc-400 text-sm leading-relaxed mb-6">{type.description}</p>

      {type.id === 'open-connection' ? (
        <div className="flex flex-col gap-2 mb-6">
          <span className="inline-flex items-center self-start text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-lg px-3 py-1.5">
            <Clock size={12} className="mr-1.5 text-zinc-500" />
            {type.duration}
          </span>
          <span className="inline-flex items-center self-start text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-lg px-3 py-1.5">
            <Video size={12} className="mr-1.5 text-zinc-500" />
            Video call
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-6">
          <span className="flex items-center text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-lg px-3 py-1.5">
            <Clock size={12} className="mr-1.5 text-zinc-500" />
            {type.duration}
          </span>
          <span className="flex items-center text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/60 rounded-lg px-3 py-1.5">
            <Calendar size={12} className="mr-1.5 text-zinc-500" />
            {type.blockDuration}
          </span>
          <span className="flex items-center text-xs text-amber-400 bg-amber-950/40 border border-amber-700/50 rounded-lg px-3 py-1.5 font-medium">
            <Shield size={12} className="mr-1.5 text-amber-500" />
            Active ZiNRAi members only
          </span>
        </div>
      )}

      <ul className="space-y-1.5">
        {type.features.map((f) => (
          <li key={f} className="flex items-center text-xs text-zinc-500">
            <AccentDot color={type.accent} />
            {f}
          </li>
        ))}
      </ul>
    </button>
  )
}

export default function BookingHome() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-950/40 rounded-full blur-3xl -translate-y-1/2" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-950/30 rounded-full blur-3xl translate-y-1/2" />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="text-center mb-16">
          <img
            src={profilePhoto}
            alt="Jens Vandenbroeke"
            className="w-[160px] h-[160px] rounded-full object-cover object-top mx-auto mb-6 border-2 border-zinc-700"
          />
          <div className="inline-flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-full px-4 py-1.5 text-xs text-zinc-400 font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Available for new calls
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-zinc-50 tracking-tight mb-4">
            Book a call with{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Jens
            </span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto leading-relaxed">
            Choose the type of call that fits your needs. Every booking is confirmed via WhatsApp.
          </p>
        </div>

        {/* Call type cards */}
        <div className="grid sm:grid-cols-2 gap-5">
          {callTypes.map((type) => (
            <CallTypeCard key={type.id} type={type} onSelect={navigate} />
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-zinc-600 text-sm mt-12">
          All times are in your local timezone &bull; Powered by Google Calendar
        </p>
      </div>
    </div>
  )
}
