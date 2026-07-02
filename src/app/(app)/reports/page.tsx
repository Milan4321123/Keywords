import { FileText } from 'lucide-react';
import ComingSoon from '@/components/ComingSoon';

export default function ReportsPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Reports"
      milestone="Milestone 8"
      description="Grounded company reports with executive summaries, KPI tables, trends, anomalies, missing data, and full source evidence. Exportable as PDF, DOCX, Markdown, HTML, and CSV."
    />
  );
}
