import { motion } from 'framer-motion';
import { Network, ChevronDown, ChevronRight, User } from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { getInitials, cn } from '../../lib/utils';
import { useState } from 'react';

interface TreeNode {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation?: { name: string } | null;
  department?: { name: string } | null;
  avatar?: string | null;
  children: TreeNode[];
}

function buildTree(employees: any[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes
  employees.forEach((emp) => {
    map.set(emp.id, { ...emp, children: [] });
  });

  // Link children to parents
  employees.forEach((emp) => {
    const node = map.get(emp.id)!;
    if (emp.manager?.id && map.has(emp.manager.id)) {
      map.get(emp.manager.id)!.children.push(node);
    } else if (!emp.managerId) {
      roots.push(node);
    } else {
      roots.push(node); // orphan — show at root
    }
  });

  return roots;
}

export default function OrgChartPage() {
  const { data: empRes, isLoading } = useGetEmployeesQuery({ page: 1, limit: 100 });
  const employees = empRes?.data || [];
  const tree = buildTree(employees);

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Organization Chart</h1>
          <p className="text-gray-500 text-sm mt-0.5">Hierarchical view of your team structure</p>
        </div>
      </div>

      {isLoading ? (
        <div className="layer-card p-12 text-center">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : tree.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Network size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No employees found</h3>
        </div>
      ) : (
        <div className="layer-card p-6 overflow-x-auto">
          <div className="min-w-[600px]">
            {tree.map((node) => (
              <OrgNode key={node.id} node={node} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrgNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: depth * 0.05 }}
    >
      <div
        className={cn(
          'flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer',
          depth === 0 && 'bg-brand-50'
        )}
        style={{ marginLeft: depth * 28 }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/collapse */}
        <div className="w-5 flex-shrink-0">
          {hasChildren ? (
            expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />
          ) : (
            <div className="w-4" />
          )}
        </div>

        {/* Avatar */}
        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0',
          depth === 0 ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'
        )}>
          {getInitials(node.firstName, node.lastName)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">
            {node.firstName} {node.lastName}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {node.designation?.name || 'No designation'}
            {node.department?.name && ` · ${node.department.name}`}
          </p>
        </div>

        {/* Code */}
        <span className="text-xs font-mono text-gray-400 flex-shrink-0" data-mono>{node.employeeCode}</span>

        {/* Children count */}
        {hasChildren && (
          <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-mono" data-mono>
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="border-l-2 border-gray-100" style={{ marginLeft: depth * 28 + 22 }}>
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
