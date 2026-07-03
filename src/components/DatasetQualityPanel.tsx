'use client';

import React, { useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface QualityIssue {
  issue_type: string;
  severity: 'info' | 'warning' | 'error';
  column: string | null;
  description: string;
  affected_count: number;
}

interface Report {
  checked_rows: number;
  issues: QualityIssue[];
}

const SEVERITY_STYLES = {
  error: { icon: AlertCircle, chip: 'bg-red-50 border-red-200 text-red-700' },
  warning: { icon: AlertTriangle, chip: 'bg-amber-50 border-amber-200 text-amber-700' },
  info: { icon: Info, chip: 'bg-slate-50 border-slate-200 text-slate-600' },
};

export default function DatasetQualityPanel({ tableId }: { tableId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/datasets/tables/${tableId}/validate`, { method: 'POST' });
      const { data, error } = await response.json();
      if (error) throw new Error(error);
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          Data quality
        </h3>
        <button
          onClick={validate}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Run quality checks
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {report && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Checked {report.checked_rows.toLocaleString()} rows —{' '}
            {report.issues.length === 0
              ? 'no issues found 🎉'
              : `${report.issues.length} issue${report.issues.length > 1 ? 's' : ''} found (saved to the quality log)`}
          </p>
          {report.issues.map((issue, i) => {
            const style = SEVERITY_STYLES[issue.severity];
            return (
              <div key={i} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-xs ${style.chip}`}>
                <style.icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">{issue.issue_type.replace(/_/g, ' ')}</span>
                  {issue.column && <span className="font-mono ml-1.5 opacity-70">({issue.column})</span>}
                  <div className="mt-0.5">{issue.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
