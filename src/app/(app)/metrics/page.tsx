import { Gauge } from 'lucide-react';
import ComingSoon from '@/components/ComingSoon';

export default function MetricsPage() {
  return (
    <ComingSoon
      icon={Gauge}
      title="Metric Catalog"
      milestone="Milestone 7"
      description="Business metrics with formulas, source datasets, dimensions, and time grain — so the AI computes 'income this month' from your data instead of guessing."
    />
  );
}
