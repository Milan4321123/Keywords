'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2 } from 'lucide-react';

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // If the user already belongs to an org (e.g. via invite), skip onboarding.
  useEffect(() => {
    fetch('/api/orgs')
      .then((r) => r.json())
      .then(({ data }) => {
        const orgs: OrgSummary[] = data?.organizations ?? [];
        if (orgs.length > 0) {
          router.replace('/dashboard');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, industry }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create organization');
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 mb-5">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">Create your organization</h1>
          <p className="text-sm text-slate-500 mb-6">
            Your organization is the workspace holding your keyword map, data, and reports.
            You can invite teammates afterwards.
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Organization name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all"
                placeholder="Acme GmbH"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Industry (optional)
              </label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all"
                placeholder="Construction, Retail, Software…"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-all"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create organization
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
