import { Check } from 'lucide-react'

export default function StepIndicator({ steps, currentStep }) {
  return (
    <div className="flex items-center gap-2 mb-10">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep
        const isCurrent = index === currentStep

        return (
          <div key={step} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
                  isCompleted
                    ? 'bg-indigo-600 text-white'
                    : isCurrent
                    ? 'bg-indigo-600/20 border border-indigo-500 text-indigo-400'
                    : 'bg-zinc-800 border border-zinc-700 text-zinc-600'
                }`}
              >
                {isCompleted ? <Check size={13} strokeWidth={2.5} /> : index + 1}
              </div>
              <span
                className={`text-sm font-medium hidden sm:block ${
                  isCurrent ? 'text-zinc-200' : isCompleted ? 'text-zinc-400' : 'text-zinc-600'
                }`}
              >
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`h-px w-8 sm:w-12 transition-all duration-300 ${
                  isCompleted ? 'bg-indigo-600' : 'bg-zinc-800'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
