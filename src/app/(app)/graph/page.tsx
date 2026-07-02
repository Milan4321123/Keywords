import { Waypoints } from 'lucide-react';
import ComingSoon from '@/components/ComingSoon';

export default function GraphPage() {
  return (
    <ComingSoon
      icon={Waypoints}
      title="Graph View"
      milestone="Milestone 3"
      description="Visual dependency graph of your keyword ontology: typed relations, traversal, and relation-aware context loading for the AI."
    />
  );
}
