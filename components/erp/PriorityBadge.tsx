import React from 'react';
import StatusBadge from './StatusBadge';
import { getPriorityLabel, getPriorityTone } from './status';

type PriorityBadgeProps = {
  priority?: string | null;
  className?: string;
};

const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority, className = '' }) => (
  <StatusBadge
    status={priority || 'low'}
    label={getPriorityLabel(priority)}
    tone={getPriorityTone(priority)}
    className={className}
  />
);

export default PriorityBadge;
