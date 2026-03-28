import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Handle,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  Network,
  ChevronDown,
  ChevronRight,
  Search,
  TreePine,
  List,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import { useGetEmployeesQuery, useUpdateEmployeeManagerMutation } from '../employee/employeeApi';
import { getInitials, cn } from '../../lib/utils';
import { useAppSelector } from '../../app/store';

// ---------- Types ----------
interface TreeNode {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation?: { name: string } | null;
  department?: { name: string } | null;
  avatar?: string | null;
  manager?: { id: string } | null;
  managerId?: string | null;
  user?: { role: string } | null;
  children: TreeNode[];
}

type EmployeeNodeData = {
  name: string;
  designation: string;
  department: string;
  employeeCode: string;
  role: string;
  avatar?: string | null;
};

// ---------- Role color config ----------
const roleBorderColors: Record<string, string> = {
  SUPER_ADMIN: 'border-indigo-400 bg-indigo-50',
  ADMIN: 'border-blue-400 bg-blue-50',
  HR: 'border-teal-400 bg-teal-50',
  MANAGER: 'border-amber-400 bg-amber-50',
  EMPLOYEE: 'border-gray-300 bg-gray-50',
  INTERN: 'border-pink-300 bg-pink-50',
};

const roleAvatarColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-500 text-white',
  ADMIN: 'bg-blue-500 text-white',
  HR: 'bg-teal-500 text-white',
  MANAGER: 'bg-amber-500 text-white',
  EMPLOYEE: 'bg-gray-400 text-white',
  INTERN: 'bg-pink-400 text-white',
};

const roleMiniMapColors: Record<string, string> = {
  SUPER_ADMIN: '#818cf8',
  ADMIN: '#60a5fa',
  HR: '#2dd4bf',
  MANAGER: '#fbbf24',
  EMPLOYEE: '#9ca3af',
  INTERN: '#f9a8d4',
};

// ---------- Custom Node ----------
function EmployeeNode({ data }: NodeProps<Node<EmployeeNodeData>>) {
  const role = (data.role as string) || 'EMPLOYEE';
  const borderClass = roleBorderColors[role] || roleBorderColors.EMPLOYEE;
  const avatarClass = roleAvatarColors[role] || roleAvatarColors.EMPLOYEE;
  const nameParts = (data.name as string).split(' ');
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(' '));

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2 !h-2" />
      <div
        className={cn(
          'w-[220px] rounded-xl border-2 px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md',
          borderClass
        )}
      >
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
              avatarClass
            )}
          >
            {initials}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{data.name as string}</p>
            <p className="text-xs text-gray-500 truncate">{data.designation as string}</p>
          </div>
          {/* Employee code */}
          <span
            className="absolute top-1.5 right-2.5 text-[10px] font-mono text-gray-400"
            data-mono
          >
            {data.employeeCode as string}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2 !h-2" />
    </>
  );
}

// ---------- Dagre Layout ----------
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 100, nodesep: 60 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 220, height: 80 });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 110, y: pos.y - 40 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------- Build flow data from employees ----------
function buildFlowData(employees: any[]) {
  const nodes: Node<EmployeeNodeData>[] = employees.map((emp) => ({
    id: emp.id,
    type: 'employee',
    data: {
      name: `${emp.firstName} ${emp.lastName}`,
      designation: emp.designation?.name || 'Employee',
      department: emp.department?.name || '',
      employeeCode: emp.employeeCode,
      role: emp.user?.role || 'EMPLOYEE',
      avatar: emp.avatar,
    },
    position: { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  }));

  const employeeIds = new Set(employees.map((e) => e.id));

  const edges: Edge[] = employees
    .filter((emp) => {
      const mgrId = emp.managerId || emp.manager?.id;
      return mgrId && employeeIds.has(mgrId);
    })
    .map((emp) => {
      const mgrId = emp.managerId || emp.manager?.id;
      return {
        id: `e-${mgrId}-${emp.id}`,
        source: mgrId,
        target: emp.id,
        type: 'smoothstep',
        style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1' },
      };
    });

  return getLayoutedElements(nodes, edges);
}

// ---------- Circular ref check ----------
function wouldCreateCycle(
  employees: any[],
  sourceId: string,
  targetManagerId: string
): boolean {
  // Walk up from targetManagerId; if we reach sourceId, it's a cycle
  const visited = new Set<string>();
  let current: string | null = targetManagerId;
  while (current) {
    if (current === sourceId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    const emp = employees.find((e) => e.id === current);
    current = emp?.managerId || emp?.manager?.id || null;
  }
  return false;
}

// ---------- Build tree for list view ----------
function buildTree(employees: any[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  employees.forEach((emp) => {
    map.set(emp.id, { ...emp, children: [] });
  });

  employees.forEach((emp) => {
    const node = map.get(emp.id)!;
    if (emp.manager?.id && map.has(emp.manager.id)) {
      map.get(emp.manager.id)!.children.push(node);
    } else if (!emp.managerId) {
      roots.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

// ---------- Main Page ----------
export default function OrgChartPage() {
  const { data: empRes, isLoading } = useGetEmployeesQuery({ page: 1, limit: 100 });
  const [updateManager] = useUpdateEmployeeManagerMutation();
  const employees = empRes?.data || [];

  const user = useAppSelector((s) => s.auth.user);
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'tree' | 'list'>('tree');
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation dialog state
  const [pendingReassign, setPendingReassign] = useState<{
    nodeId: string;
    nodeName: string;
    targetId: string;
    targetName: string;
  } | null>(null);

  // React Flow data
  const flowData = useMemo(() => {
    if (employees.length === 0) return { nodes: [], edges: [] };
    return buildFlowData(employees);
  }, [employees]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);

  // Sync when employees change
  useMemo(() => {
    if (flowData.nodes.length > 0) {
      setNodes(flowData.nodes);
      setEdges(flowData.edges);
    }
  }, [flowData, setNodes, setEdges]);

  const nodeTypes = useMemo(() => ({ employee: EmployeeNode }), []);

  // Handle node drag stop in edit mode — find nearest node
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (!editMode) return;

      const PROXIMITY = 100;
      let closestNode: Node | null = null;
      let closestDist = Infinity;

      for (const n of nodes) {
        if (n.id === draggedNode.id) continue;
        const dx = n.position.x - draggedNode.position.x;
        const dy = n.position.y - draggedNode.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PROXIMITY && dist < closestDist) {
          closestDist = dist;
          closestNode = n;
        }
      }

      if (closestNode) {
        // Validate: not self, not circular
        if (closestNode.id === draggedNode.id) return;
        if (wouldCreateCycle(employees, draggedNode.id, closestNode.id)) {
          return;
        }

        setPendingReassign({
          nodeId: draggedNode.id,
          nodeName: draggedNode.data?.name as string,
          targetId: closestNode.id,
          targetName: closestNode.data?.name as string,
        });
      }
    },
    [editMode, nodes, employees]
  );

  const confirmReassign = async () => {
    if (!pendingReassign) return;
    try {
      await updateManager({
        id: pendingReassign.nodeId,
        managerId: pendingReassign.targetId,
      }).unwrap();
    } catch {
      // Error handled by RTK Query
    }
    setPendingReassign(null);
  };

  const cancelReassign = () => {
    setPendingReassign(null);
    // Reset layout
    setNodes(flowData.nodes);
    setEdges(flowData.edges);
  };

  // List view
  const tree = useMemo(() => buildTree(employees), [employees]);
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(
      (emp: any) =>
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q) ||
        emp.employeeCode?.toLowerCase().includes(q) ||
        emp.designation?.name?.toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);
  const filteredTree = useMemo(() => buildTree(filteredEmployees), [filteredEmployees]);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Organization Chart</h1>
          <p className="text-gray-500 text-sm mt-0.5">Hierarchical view of your team structure</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tab toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('tree')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'tree'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <TreePine size={15} />
              Tree View
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'list'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <List size={15} />
              List View
            </button>
          </div>

          {/* Edit mode toggle (admin only) */}
          {canEdit && activeTab === 'tree' && (
            <button
              onClick={() => setEditMode(!editMode)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                editMode
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
              )}
            >
              {editMode ? (
                <>
                  <X size={15} />
                  Exit Edit
                </>
              ) : (
                <>
                  <Pencil size={15} />
                  Edit Structure
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="layer-card p-12 text-center">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : employees.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Network size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No employees found</h3>
        </div>
      ) : activeTab === 'tree' ? (
        /* ---------- Tree View ---------- */
        <div className="layer-card relative overflow-hidden rounded-xl">
          {editMode && (
            <div className="absolute top-3 left-3 z-10 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-lg">
              Drag a node near another to reassign its manager
            </div>
          )}
          <div style={{ height: 'calc(100vh - 200px)' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
              nodesDraggable={editMode}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={1.5}
              attributionPosition="bottom-left"
            >
              <Background color="#f1f5f9" gap={20} />
              <Controls position="top-right" />
              <MiniMap
                position="bottom-right"
                nodeColor={(n) => roleMiniMapColors[(n.data as EmployeeNodeData)?.role] || '#e2e8f0'}
              />
            </ReactFlow>
          </div>
        </div>
      ) : (
        /* ---------- List View ---------- */
        <div className="layer-card p-6">
          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {filteredTree.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No employees match your search</p>
              ) : (
                filteredTree.map((node) => <OrgNode key={node.id} node={node} depth={0} />)
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {pendingReassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
          >
            <h3 className="text-lg font-display font-semibold text-gray-900 mb-2">
              Reassign Manager
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Move <span className="font-semibold">{pendingReassign.nodeName}</span> under{' '}
              <span className="font-semibold">{pendingReassign.targetName}</span> as their new
              manager?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={cancelReassign}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmReassign}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
              >
                <Check size={15} />
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ---------- List View Node ----------
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
            expanded ? (
              <ChevronDown size={16} className="text-gray-400" />
            ) : (
              <ChevronRight size={16} className="text-gray-400" />
            )
          ) : (
            <div className="w-4" />
          )}
        </div>

        {/* Avatar */}
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0',
            depth === 0 ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'
          )}
        >
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
        <span className="text-xs font-mono text-gray-400 flex-shrink-0" data-mono>
          {node.employeeCode}
        </span>

        {/* Children count */}
        {hasChildren && (
          <span
            className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-mono"
            data-mono
          >
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
