import { redirect } from 'next/navigation';

export default function RootPage() {
  // Middleware sends unauthenticated visitors to /login before this runs.
  redirect('/dashboard');
}
