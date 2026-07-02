import { MessageSquare } from 'lucide-react';
import ComingSoon from '@/components/ComingSoon';

export default function ChatPage() {
  return (
    <ComingSoon
      icon={MessageSquare}
      title="AI Chat"
      milestone="Milestone 6"
      description="The full AI router with Ask / Analyze / Report / Forecast modes and organization-wide scope. Until then, use the assistant on the Keyword Map and the analytics chat in the Data Hub."
    />
  );
}
