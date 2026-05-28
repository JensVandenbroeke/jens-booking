import { useState } from 'react'

const COUNTRIES = [
  { code: 'BE', dial: '+32', flag: '🇧🇪', name: 'Belgium' },
  { code: 'NL', dial: '+31', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'DE', dial: '+49', flag: '🇩🇪', name: 'Germany' },
  { code: 'FR', dial: '+33', flag: '🇫🇷', name: 'France' },
  { code: 'GB', dial: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'US', dial: '+1', flag: '🇺🇸', name: 'United States' },
  { code: 'PT', dial: '+351', flag: '🇵🇹', name: 'Portugal' },
  { code: 'ES', dial: '+34', flag: '🇪🇸', name: 'Spain' },
  { code: 'IT', dial: '+39', flag: '🇮🇹', name: 'Italy' },
  { code: 'AU', dial: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: 'CA', dial: '+1', flag: '🇨🇦', name: 'Canada' },
  { code: 'JP', dial: '+81', flag: '🇯🇵', name: 'Japan' },
  { code: 'SG', dial: '+65', flag: '🇸🇬', name: 'Singapore' },
  { code: 'ZA', dial: '+27', flag: '🇿🇦', name: 'South Africa' },
  { code: 'BR', dial: '+55', flag: '🇧🇷', name: 'Brazil' },
  { code: 'MX', dial: '+52', flag: '🇲🇽', name: 'Mexico' },
  { code: 'IN', dial: '+91', flag: '🇮🇳', name: 'India' },
  { code: 'AE', dial: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: 'TR', dial: '+90', flag: '🇹🇷', name: 'Turkey' },
  { code: 'PL', dial: '+48', flag: '🇵🇱', name: 'Poland' },
]

function formatLocalNumber(raw, dialCode) {
  // Remove everything except digits
  let digits = raw.replace(/\D/g, '')
  // Remove leading 0 for BE/NL/DE etc (e.g. 0494 → 494)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

export default function PhoneInput({ value, onChange, error }) {
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0])
  const [localNumber, setLocalNumber] = useState('')
  const [open, setOpen] = useState(false)

  const handleNumberChange = (e) => {
    const raw = e.target.value
    setLocalNumber(raw)
    const digits = formatLocalNumber(raw, selectedCountry.dial)
    const full = digits ? `${selectedCountry.dial}${digits}` : ''
    onChange(full)
  }

  const handleCountrySelect = (country) => {
    setSelectedCountry(country)
    setOpen(false)
    const digits = formatLocalNumber(localNumber, country.dial)
    const full = digits ? `${country.dial}${digits}` : ''
    onChange(full)
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 h-11 px-3 bg-zinc-800/60 border border-zinc-700 rounded-xl text-sm text-zinc-300 hover:border-zinc-600 transition-colors whitespace-nowrap"
          >
            <span>{selectedCountry.flag}</span>
            <span className="text-zinc-400">{selectedCountry.dial}</span>
            <span className="text-zinc-600 text-xs">▾</span>
          </button>
          {open && (
            <div className="absolute top-12 left-0 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl max-h-60 overflow-y-auto w-56">
              {COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleCountrySelect(country)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors text-left"
                >
                  <span>{country.flag}</span>
                  <span className="flex-1">{country.name}</span>
                  <span className="text-zinc-500">{country.dial}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="tel"
          value={localNumber}
          onChange={handleNumberChange}
          placeholder="494 41 88 57"
          className="input-field flex-1"
        />
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
