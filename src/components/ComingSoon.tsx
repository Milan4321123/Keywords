import { LucideIcon } from 'lucide-react';

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  milestone: string;
  description: string;
}

export default function ComingSoon({ icon: Icon, title, milestone, description }: ComingSoonProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 mb-6">
        <Icon className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">{title}</h1>
      <p className="text-slate-500 max-w-md mx-auto leading-relaxed">{description}</p>
      <div className="mt-6 inline-flex items-center px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-600">
        Arrives in {milestone}
      </div>
    </div>
  );
}
