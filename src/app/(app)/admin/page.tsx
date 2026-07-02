'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, Mail, Loader2, Trash2, ShieldCheck } from 'lucide-react';

interface MemberRow {
  id: string;
  role: string;
  created_at: string;
  profiles: { id: string; email: string; full_name: string | null } | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

const ROLES = ['admin', 'manager', 'analyst', 'editor', 'viewer', 'guest'];

export default function AdminPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/orgs/members');
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const response = await fetch('/api/orgs/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const { error } = await response.json();
      if (error) throw new Error(error);
      setInviteEmail('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (memberId: string, role: string) => {
    const response = await fetch('/api/orgs/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, role }),
    });
    const { error } = await response.json();
    if (error) setError(error);
    await load();
  };

  const remove = async (params: string) => {
    if (!confirm('Remove this member/invite?')) return;
    const response = await fetch(`/api/orgs/members?${params}`, { method: 'DELETE' });
    const { error } = await response.json();
    if (error) setError(error);
    await load();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-slate-400" />
          Members
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage who can access this organization and what they can do.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Invite */}
      <form
        onSubmit={invite}
        className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3"
      >
        <div className="flex-1 relative">
          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all"
          />
        </div>
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
          className="px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={inviting}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-all"
        >
          {inviting && <Loader2 className="w-4 h-4 animate-spin" />}
          Invite
        </button>
      </form>

      {/* Members */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-semibold">Member</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">
                      {member.profiles?.full_name || member.profiles?.email}
                    </div>
                    {member.profiles?.full_name && (
                      <div className="text-xs text-slate-400">{member.profiles.email}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {member.role === 'owner' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold">
                        <ShieldCheck className="w-3.5 h-3.5" /> owner
                      </span>
                    ) : (
                      <select
                        value={member.role}
                        onChange={(e) => changeRole(member.id, e.target.value)}
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {member.role !== 'owner' && (
                      <button
                        onClick={() => remove(`member_id=${member.id}`)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {invites.map((invite) => (
                <tr key={invite.id} className="bg-slate-50/50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-500">{invite.email}</div>
                    <div className="text-xs text-amber-600">Invite pending</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-500 font-medium">{invite.role}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => remove(`invite_id=${invite.id}`)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
