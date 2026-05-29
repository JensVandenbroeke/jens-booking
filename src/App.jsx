import { Routes, Route } from 'react-router-dom'
import BookingHome from './pages/BookingHome'
import OpenConnectionFlow from './pages/OpenConnectionFlow'
import CoachingCallFlow from './pages/CoachingCallFlow'
import Confirmation from './pages/Confirmation'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingHome />} />
      <Route path="/open-connection" element={<OpenConnectionFlow />} />
      <Route path="/coaching" element={<CoachingCallFlow />} />
      <Route path="/coaching-call" element={<CoachingCallFlow />} />
      <Route path="/confirmation" element={<Confirmation />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
