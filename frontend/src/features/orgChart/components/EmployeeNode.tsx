import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils';
import { getInitials } from '../../../lib/utils';
import type { EmployeeNodeData } from '../types';
import { getRoleConfig, resolveDisplayRole } from '../constants';

export default function EmployeeNode({ data }: NodeProps<Node<EmployeeNodeData>>) {
  const rawRole = data.role || 'EMPLOYEE';
  const designation = data.designation;
  const displayRole = resolveDisplayRole(rawRole, designation);
  const config = getRoleConfig(displayRole);
  const initials = getInitials(data.firstName, data.lastName);
  const selected = data.isSelected;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2 !h-2" />
      <div
        role="treeitem"
        aria-label={`${data.name}, ${designation || 'No designation'}, ${config.label}`}
        className={cn(
          'w-[220px] rounded-xl border-2 px-3 py-2.5 shadow-sm transition-all hover:shadow-md cursor-pointer',
          selected ? '' : config.border
        )}
        style={selected ? { borderColor: 'var(--primary-color)', background: 'var(--primary-highlighted-color)' } : undefined}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn('w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', config.avatar)}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{data.name}</p>
            <p className="text-xs text-gray-500 truncate">{designation || 'No designation'}</p>
          </div>
          <span className="absolute top-1.5 right-2.5 text-[10px] font-mono text-gray-400" data-mono>
            {data.employeeCode}
          </span>
        </div>
        {/* Role text badge for accessibility (not color-only) */}
        <span className={cn('absolute bottom-1 right-2 text-[8px] px-1.5 py-0.5 rounded-full font-medium', config.badge)}>
          {config.label}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2 !h-2" />
    </>
  );
}
