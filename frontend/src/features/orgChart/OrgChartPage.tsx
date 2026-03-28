import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  Link2Off,
  Link2,
  UserCog,
  Loader2,
  Save,
  ExternalLink,
} from 'lucide-react';
import { useGetEmployeesQuery, useUpdateEmployeeMutation, useUpdateEmployeeManagerMutation } from '../employee/employeeApi';
import { getInitials, cn } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

// ---------- Types ----------
interface TreeNode {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation?: { name: string } | null;
  department?: { name: string } | null;
  avatar?: string | null;
  manager?: { id: string; firstName?: string; lastName?: string } | null;
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
  isSelected?: boolean;
};

// ---------- Role color config ----------
const roleBorderColors: Record<string, string> = {
  SUPER_ADMIN: 'border-indigo-400 bg-indigo-50',
  ADMIN: 'border-blue-400 bg-blue-50',
  HR: 'border-teal-400 bg-teal-50',
  MANAGER: 'border-amber-400 bg-amber-50',
  EMPLOYEE: 'border-sky-300 bg-sky-50',
  GUEST_INTERVIEWER: 'border-orange-300 bg-orange-50',
  INTERN: 'border-pink-300 bg-pink-50',
  UNASSIGNED: 'border-gray-200 bg-gray-50/50 opacity-60',
};

const roleAvatarColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-500 text-white',
  ADMIN: 'bg-blue-500 text-white',
  HR: 'bg-teal-500 text-white',
  MANAGER: 'bg-amber-500 text-white',
  EMPLOYEE: 'bg-sky-500 text-white',
  GUEST_INTERVIEWER: 'bg-orange-400 text-white',
  INTERN: 'bg-pink-400 text-white',
  UNASSIGNED: 'bg-gray-300 text-gray-500',
};

const roleMiniMapColors: Record<string, string> = {
  SUPER_ADMIN: '#818cf8',
  ADMIN: '#60a5fa',
  HR: '#2dd4bf',
  MANAGER: '#fbbf24',
  EMPLOYEE: '#38bdf8',
  GUEST_INTERVIEWER: '#fb923c',
  INTERN: '#f9a8d4',
  UNASSIGNED: '#d1d5db',
};

// ---------- Custom Node ----------
function EmployeeNode({ data }: NodeProps<Node<EmployeeNodeData>>) {
  const rawRole = (data.role as string) || 'EMPLOYEE';
  const designation = data.designation as string;
  // If no real designation, treat as unassigned (Teams email account)
  const isUnassigned = !designation || designation === 'Employee';
  const role = isUnassigned && rawRole === 'EMPLOYEE' ? 'UNASSIGNED' : rawRole;
  const borderClass = roleBorderColors[role] || roleBorderColors.EMPLOYEE;
  const avatarClass = roleAvatarColors[role] || roleAvatarColors.EMPLOYEE;
  const nameParts = (data.name as string).split(' ');
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(' '));
  const selected = data.isSelected as boolean;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2 !h-2" />
      <div
        className={cn(
          'w-[220px] rounded-xl border-2 px-3 py-2.5 shadow-sm transition-all hover:shadow-md cursor-pointer',
          selected ? 'ring-2 ring-brand-500 border-brand-400 bg-brand-50/50' : borderClass
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0', avatarClass)}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{data.name as string}</p>
            <p className="text-xs text-gray-500 truncate">{data.designation as string}</p>
          </div>
          <span className="absolute top-1.5 right-2.5 text-[10px] font-mono text-gray-400" data-mono>
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
  nodes.forEach((node) => g.setNode(node.id, { width: 220, height: 80 }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  dagre.layout(g);
  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      return { ...node, position: { x: pos.x - 110, y: pos.y - 40 } };
    }),
    edges,
  };
}

// ---------- Build flow data ----------
function buildFlowData(employees: any[], selectedId: string | null) {
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
      isSelected: emp.id === selectedId,
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
function wouldCreateCycle(employees: any[], sourceId: string, targetManagerId: string): boolean {
  const visited = new Set<string>();
  let current: string | null = targetManagerId;
  while (current) {
    if (current === sourceId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    const emp = employees.find((e: any) => e.id === current);
    current = emp?.managerId || emp?.manager?.id || null;
  }
  return false;
}

// ---------- Build tree for list view ----------
function buildTree(employees: any[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  employees.forEach((emp) => map.set(emp.id, { ...emp, children: [] }));
  employees.forEach((emp) => {
    const node = map.get(emp.id)!;
    if (emp.manager?.id && map.has(emp.manager.id)) {
      map.get(emp.manager.id)!.children.push(node);
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
  const [updateEmployee, { isLoading: saving }] = useUpdateEmployeeMutation();
  const employees = empRes?.data || [];

  const user = useAppSelector((s) => s.auth.user);
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<'tree' | 'list'>('tree');
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Confirmation dialog
  const [pendingReassign, setPendingReassign] = useState<{
    nodeId: string; nodeName: string; targetId: string; targetName: string;
  } | null>(null);

  // Selected employee data
  const selectedEmployee = useMemo(() => employees.find((e: any) => e.id === selectedNodeId), [employees, selectedNodeId]);
  const selectedManager = useMemo(() => {
    if (!selectedEmployee) return null;
    const mgrId = selectedEmployee.managerId || selectedEmployee.manager?.id;
    return mgrId ? employees.find((e: any) => e.id === mgrId) : null;
  }, [selectedEmployee, employees]);

  // React Flow data
  const flowData = useMemo(() => {
    if (employees.length === 0) return { nodes: [], edges: [] };
    return buildFlowData(employees, selectedNodeId);
  }, [employees, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);

  useEffect(() => {
    if (flowData.nodes.length > 0) {
      setNodes(flowData.nodes);
      setEdges(flowData.edges);
    }
  }, [flowData, setNodes, setEdges]);

  const nodeTypes = useMemo(() => ({ employee: EmployeeNode }), []);

  // Node click = select
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Drag stop in edit mode
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
      if (closestNode && closestNode.id !== draggedNode.id) {
        if (wouldCreateCycle(employees, draggedNode.id, closestNode.id)) {
          toast.error('Cannot create circular reporting structure');
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
      await updateManager({ id: pendingReassign.nodeId, managerId: pendingReassign.targetId }).unwrap();
      toast.success(`${pendingReassign.nodeName} now reports to ${pendingReassign.targetName}`);
    } catch {
      toast.error('Failed to update manager');
    }
    setPendingReassign(null);
  };

  const cancelReassign = () => {
    setPendingReassign(null);
    setNodes(flowData.nodes);
    setEdges(flowData.edges);
  };

  // Delink: remove manager (make root)
  const handleDelink = async () => {
    if (!selectedNodeId) return;
    try {
      await updateManager({ id: selectedNodeId, managerId: null }).unwrap();
      toast.success('Manager removed — employee is now a root node');
      setSelectedNodeId(null);
    } catch {
      toast.error('Failed to remove manager');
    }
  };

  // Link to new manager
  const handleLinkToManager = async (managerId: string) => {
    if (!selectedNodeId) return;
    if (wouldCreateCycle(employees, selectedNodeId, managerId)) {
      toast.error('Cannot create circular reporting structure');
      return;
    }
    try {
      await updateManager({ id: selectedNodeId, managerId }).unwrap();
      toast.success('Manager assigned');
      setShowLinkModal(false);
      setSelectedNodeId(null);
    } catch {
      toast.error('Failed to assign manager');
    }
  };

  // List view tree
  const tree = useMemo(() => buildTree(employees), [employees]);
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter((emp: any) =>
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
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setActiveTab('tree')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'tree' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              <TreePine size={15} /> Tree View
            </button>
            <button onClick={() => setActiveTab('list')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              <List size={15} /> List View
            </button>
          </div>
          {canEdit && activeTab === 'tree' && (
            <button onClick={() => { setEditMode(!editMode); setSelectedNodeId(null); }}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                editMode ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100')}>
              {editMode ? <><X size={15} /> Exit Edit</> : <><Pencil size={15} /> Edit Structure</>}
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
        <div className="flex gap-4">
          {/* Tree View */}
          <div className={cn('layer-card relative overflow-hidden rounded-xl flex-1 transition-all', selectedNodeId && editMode ? 'mr-0' : '')}>
            {editMode && (
              <div className="absolute top-3 left-3 z-10 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-lg">
                Drag a node near another to reassign · Click a node to select
              </div>
            )}
            <div style={{ height: 'calc(100vh - 200px)' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={onNodeClick}
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
                <MiniMap position="bottom-right" nodeColor={(n) => {
                  const d = n.data as EmployeeNodeData;
                  const r = d?.role || 'EMPLOYEE';
                  const isUn = (!d?.designation || d.designation === 'Employee') && r === 'EMPLOYEE';
                  return roleMiniMapColors[isUn ? 'UNASSIGNED' : r] || '#e2e8f0';
                }} />
              </ReactFlow>
            </div>
          </div>

          {/* Right Panel: Selected Node Details */}
          <AnimatePresence>
            {selectedNodeId && selectedEmployee && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex-shrink-0 overflow-hidden"
              >
                <NodeDetailPanel
                  employee={selectedEmployee}
                  manager={selectedManager}
                  employees={employees}
                  canEdit={canEdit}
                  editMode={editMode}
                  saving={saving}
                  onClose={() => setSelectedNodeId(null)}
                  onDelink={handleDelink}
                  onShowLinkModal={() => setShowLinkModal(true)}
                  onUpdateEmployee={updateEmployee}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* List View */
        <div className="layer-card p-6">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search employees..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
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

      {/* Reassign Confirmation Dialog */}
      {pendingReassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-display font-semibold text-gray-900 mb-2">Reassign Manager</h3>
            <p className="text-sm text-gray-600 mb-5">
              Move <span className="font-semibold">{pendingReassign.nodeName}</span> under{' '}
              <span className="font-semibold">{pendingReassign.targetName}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={cancelReassign} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={confirmReassign} className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700">
                <Check size={15} /> Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Link to Manager Modal */}
      {showLinkModal && selectedNodeId && (
        <LinkManagerModal
          employees={employees}
          currentId={selectedNodeId}
          currentManagerId={selectedEmployee?.managerId || selectedEmployee?.manager?.id}
          onLink={handleLinkToManager}
          onClose={() => setShowLinkModal(false)}
        />
      )}
    </div>
  );
}

// ---------- Node Detail Panel ----------
function NodeDetailPanel({
  employee, manager, employees, canEdit, editMode, saving, onClose, onDelink, onShowLinkModal, onUpdateEmployee,
}: {
  employee: any; manager: any; employees: any[]; canEdit: boolean; editMode: boolean; saving: boolean;
  onClose: () => void; onDelink: () => void; onShowLinkModal: () => void; onUpdateEmployee: any;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState(employee.firstName);
  const [editLastName, setEditLastName] = useState(employee.lastName);
  const [editDesignation, setEditDesignation] = useState(employee.designation?.name || '');

  useEffect(() => {
    setEditFirstName(employee.firstName);
    setEditLastName(employee.lastName);
    setEditDesignation(employee.designation?.name || '');
    setIsEditing(false);
  }, [employee]);

  const role = employee.user?.role || 'EMPLOYEE';
  const avatarClass = roleAvatarColors[role] || roleAvatarColors.EMPLOYEE;
  const hasManager = !!(employee.managerId || employee.manager?.id);
  const directReports = employees.filter((e: any) => (e.managerId || e.manager?.id) === employee.id);

  const handleSave = async () => {
    try {
      await onUpdateEmployee({ id: employee.id, data: { firstName: editFirstName, lastName: editLastName } }).unwrap();
      toast.success('Employee details updated');
      setIsEditing(false);
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <div className="layer-card p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Employee Details</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} className="text-gray-400" /></button>
      </div>

      {/* Avatar + Name */}
      <div className="text-center mb-4">
        <div className={cn('w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold mx-auto mb-2', avatarClass)}>
          {getInitials(employee.firstName, employee.lastName)}
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)}
              className="input-glass w-full text-sm text-center" placeholder="First Name" />
            <input value={editLastName} onChange={(e) => setEditLastName(e.target.value)}
              className="input-glass w-full text-sm text-center" placeholder="Last Name" />
          </div>
        ) : (
          <>
            <p className="font-semibold text-gray-800">{employee.firstName} {employee.lastName}</p>
            <p className="text-xs text-gray-500">{employee.designation?.name || 'No designation'}</p>
          </>
        )}
        <span className="inline-block mt-1 text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded" data-mono>
          {employee.employeeCode}
        </span>
      </div>

      {/* Info grid */}
      <div className="space-y-2.5 mb-4">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Department</span>
          <span className="text-gray-700 font-medium">{employee.department?.name || '—'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Role</span>
          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium',
            role === 'SUPER_ADMIN' ? 'bg-indigo-100 text-indigo-700' :
            role === 'ADMIN' ? 'bg-blue-100 text-blue-700' :
            role === 'HR' ? 'bg-teal-100 text-teal-700' :
            role === 'MANAGER' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
          )}>{role}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Reports to</span>
          <span className="text-gray-700 font-medium">
            {manager ? `${manager.firstName} ${manager.lastName}` : 'None (Root)'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Direct reports</span>
          <span className="text-gray-700 font-medium">{directReports.length}</span>
        </div>
      </div>

      {/* Direct reports list */}
      {directReports.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-1.5">Direct Reports</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {directReports.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 text-xs p-1.5 rounded-lg bg-gray-50">
                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-bold">
                  {getInitials(r.firstName, r.lastName)}
                </div>
                <span className="text-gray-700">{r.firstName} {r.lastName}</span>
                <span className="text-gray-400 ml-auto font-mono" data-mono>{r.employeeCode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {canEdit && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          {isEditing ? (
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-white bg-brand-600 rounded-lg hover:bg-brand-700">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
              <button onClick={() => setIsEditing(false)}
                className="flex-1 px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setIsEditing(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 border border-brand-200">
              <UserCog size={13} /> Edit Details
            </button>
          )}

          <button onClick={onShowLinkModal}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 border border-emerald-200">
            <Link2 size={13} /> {hasManager ? 'Change Manager' : 'Assign Manager'}
          </button>

          {hasManager && (
            <button onClick={onDelink}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 border border-red-200">
              <Link2Off size={13} /> Remove Manager (Delink)
            </button>
          )}

          <a href={`/employees/${employee.id}`} target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
            <ExternalLink size={13} /> View Full Profile
          </a>
        </div>
      )}
    </div>
  );
}

// ---------- Link Manager Modal ----------
function LinkManagerModal({
  employees, currentId, currentManagerId, onLink, onClose,
}: {
  employees: any[]; currentId: string; currentManagerId?: string;
  onLink: (managerId: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const available = employees.filter((e: any) => {
    if (e.id === currentId) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.employeeCode?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-display font-semibold text-gray-900">Select Manager</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" autoFocus />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1">
          {available.map((emp: any) => {
            const isCurrent = emp.id === currentManagerId;
            const role = emp.user?.role || 'EMPLOYEE';
            return (
              <button key={emp.id} onClick={() => !isCurrent && onLink(emp.id)}
                className={cn('w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors',
                  isCurrent ? 'bg-brand-50 border border-brand-200 cursor-default' : 'hover:bg-gray-50')}>
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  roleAvatarColors[role] || roleAvatarColors.EMPLOYEE)}>
                  {getInitials(emp.firstName, emp.lastName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-gray-400 truncate">{emp.designation?.name || 'Employee'} · {emp.department?.name || ''}</p>
                </div>
                <span className="text-[10px] font-mono text-gray-400" data-mono>{emp.employeeCode}</span>
                {isCurrent && <span className="text-[10px] text-brand-600 font-medium">Current</span>}
              </button>
            );
          })}
          {available.length === 0 && <p className="text-center text-gray-400 text-sm py-6">No employees found</p>}
        </div>
      </motion.div>
    </div>
  );
}

// ---------- List View Node ----------
function OrgNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: depth * 0.05 }}>
      <div
        className={cn('flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-surface-2 transition-colors cursor-pointer', depth === 0 && 'bg-brand-50')}
        style={{ marginLeft: depth * 28 }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="w-5 flex-shrink-0">
          {hasChildren ? (expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />) : <div className="w-4" />}
        </div>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0',
          depth === 0 ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700')}>
          {getInitials(node.firstName, node.lastName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{node.firstName} {node.lastName}</p>
          <p className="text-xs text-gray-400 truncate">
            {node.designation?.name || 'No designation'}{node.department?.name && ` · ${node.department.name}`}
          </p>
        </div>
        <span className="text-xs font-mono text-gray-400 flex-shrink-0" data-mono>{node.employeeCode}</span>
        {hasChildren && <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-mono" data-mono>{node.children.length}</span>}
      </div>
      {expanded && hasChildren && (
        <div className="border-l-2 border-gray-100" style={{ marginLeft: depth * 28 + 22 }}>
          {node.children.map((child) => <OrgNode key={child.id} node={child} depth={depth + 1} />)}
        </div>
      )}
    </motion.div>
  );
}
