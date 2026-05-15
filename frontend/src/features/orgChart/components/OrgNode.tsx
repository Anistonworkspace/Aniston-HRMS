import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn, getInitials } from '../../../lib/utils';
import type { TreeNode } from '../types';
import { LIST_AUTO_EXPAND_DEPTH } from '../constants';

interface OrgNodeProps {
  node: TreeNode;
  depth: number;
}

export default function OrgNode({ node, depth }: OrgNodeProps) {
  const [expanded, setExpanded] = useState(depth < LIST_AUTO_EXPAND_DEPTH);
  const hasChildren = node.children.length > 0;

  const handleToggle = useCallback(() => {
    if (hasChildren) setExpanded((prev) => !prev);
  }, [hasChildren]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
    if (e.key === 'ArrowRight' && hasChildren && !expanded) {
      e.preventDefault();
      setExpanded(true);
    }
    if (e.key === 'ArrowLeft' && hasChildren && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  }, [hasChildren, expanded, handleToggle]);

  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: depth * 0.05 }}>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        aria-label={`${node.firstName} ${node.lastName}, ${node.designation?.name || 'No designation'}, ${node.children.length} direct reports`}
        tabIndex={0}
        className={cn('flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer focus:outline-none', depth === 0 ? '' : '')}
        style={depth === 0 ? { background: 'var(--primary-highlighted-color)' } : undefined}
        style={{ marginLeft: depth * 28 }}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        <div className="w-5 flex-shrink-0" aria-hidden="true">
          {hasChildren ? (expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />) : <div className="w-4" />}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0"
          style={depth === 0 ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}
          aria-hidden="true">
          {getInitials(node.firstName, node.lastName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{node.firstName} {node.lastName}</p>
          <p className="text-xs text-gray-400 truncate">
            {node.designation?.name || 'No designation'}{node.department?.name && ` \u00b7 ${node.department.name}`}
          </p>
        </div>
        <span className="text-xs font-mono text-gray-400 flex-shrink-0" data-mono>{node.employeeCode}</span>
        {hasChildren && <span className="text-xs px-2 py-0.5 rounded-full font-mono" data-mono style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>{node.children.length}</span>}
      </div>
      {expanded && hasChildren && (
        <div className="border-l-2 border-gray-100" style={{ marginLeft: depth * 28 + 22 }} role="group">
          {node.children.map((child) => <OrgNode key={child.id} node={child} depth={depth + 1} />)}
        </div>
      )}
    </motion.div>
  );
}
