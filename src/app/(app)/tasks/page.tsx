import { ListChecks } from 'lucide-react';
import ComingSoon from '@/components/ComingSoon';

export default function TasksPage() {
  return (
    <ComingSoon
      icon={ListChecks}
      title="Tasks & Workflows"
      milestone="Milestone 10"
      description="Keyword-linked tasks with subtasks, dependencies, blocked-task detection, workflow templates, and AI-generated checklists and summaries."
    />
  );
}
