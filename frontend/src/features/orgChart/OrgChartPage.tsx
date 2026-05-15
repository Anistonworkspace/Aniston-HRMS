import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Network, TreePine, List, Pencil, X, Check, Search, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import { useGetEmployeesQuery, useUpdateEmployeeMutation, useUpdateEmployeeManagerMutation } from '../employee/employeeApi';

import type { OrgEmployee, EmployeeNodeData, PendingReassign } from './types';
import { ADMIN_ROLES, DRAG_PROXIMITY_PX, DETAIL_PANEL_WIDTH, ORG_CHART_EMPLOYEE_LIMIT, getRoleConfig, resolveDisplayRole } from './constants';
import { buildFlowData, buildTree, wouldCreateCycle } from './utils';

import EmployeeNode from './components/EmployeeNode';
import NodeDetailPanel from './components/NodeDetailPanel';
import LinkManagerModal from './components/LinkManagerModal';
import OrgNode from './components/OrgNode';

// ---------- Main Page ----------
export default function OrgChartPage() {
  // Fetch ALL employees — no artificial limit
  const { data: empRes, isLoading, isError, error } = useGetEmployeesQuery({ page: 1, limit: ORG_CHART_EMPLOYEE_LIMIT });
  const [updateManager, { isLoading: isReassigning }] = useUpdateEmployeeManagerMutation();
  const [updateEmployee, { isLoading: saving }] = useUpdateEmployeeMutation();
  const employees: OrgEmployee[] = empRes?.data || [];
  const totalEmployees = empRes?.meta?.total || 0;

  const user = useAppSelector((s) => s.auth.user);
  const canEdit = ADMIN_ROLES.includes(user?.role || '');

  const [activeTab, setActiveTab] = useState<'tree' | 'list'>('tree');
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null);

  // Selected employee data
  const selectedEmployee = useMemo(() => employees.find((e) => e.id === selectedNodeId) || null, [employees, selectedNodeId]);
  const selectedManager = useMemo(() => {
    if (!selectedEmployee) return null;
    const mgrId = selectedEmployee.managerId || selectedEmployee.manager?.id;
    return mgrId ? employees.find((e) => e.id === mgrId) || null : null;
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

  // Node click = select/deselect
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Drag stop in edit mode — proximity-based reassignment
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (!editMode) return;
      let closestNode: Node | null = null;
      let closestDist = Infinity;
      for (const n of nodes) {
        if (n.id === draggedNode.id) continue;
        const dx = n.position.x - draggedNode.position.x;
        const dy = n.position.y - draggedNode.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DRAG_PROXIMITY_PX && dist < closestDist) {
          closestDist = dist;
          closestNode = n;
        }
      }
      if (closestNode) {
        if (wouldCreateCycle(employees, draggedNode.id, closestNode.id)) {
          toast.error('Cannot create circular reporting structure');
          return;
        }
        setPendingReassign({
          nodeId: draggedNode.id,
          nodeName: (draggedNode.data as EmployeeNodeData)?.name || '',
          targetId: closestNode.id,
          targetName: (closestNode.data as EmployeeNodeData)?.name || '',
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
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'data' in err
        ? (err as { data?: { error?: { message?: string } } }).data?.error?.message || 'Failed to update manager'
        : 'Failed to update manager';
      toast.error(message);
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
      toast.success('Manager removed \u2014 employee is now a root node');
      setSelectedNodeId(null);
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'data' in err
        ? (err as { data?: { error?: { message?: string } } }).data?.error?.message || 'Failed to remove manager'
        : 'Failed to remove manager';
      toast.error(message);
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
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'data' in err
        ? (err as { data?: { error?: { message?: string } } }).data?.error?.message || 'Failed to assign manager'
        : 'Failed to assign manager';
      toast.error(message);
    }
  };

  // List view tree
  const tree = useMemo(() => buildTree(employees), [employees]);
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter((emp) =>
      `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q) ||
      emp.employeeCode?.toLowerCase().includes(q) ||
      emp.designation?.name?.toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);
  const filteredTree = useMemo(() => buildTree(filteredEmployees), [filteredEmployees]);

  // MiniMap color function
  const miniMapNodeColor = useCallback((n: Node) => {
    const d = n.data as EmployeeNodeData;
    const displayRole = resolveDisplayRole(d?.role || 'EMPLOYEE', d?.designation);
    return getRoleConfig(displayRole).minimap;
  }, []);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Organization Chart</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Hierarchical view of your team structure
            {totalEmployees > employees.length && (
              <span className="text-amber-600 ml-2">
                (Showing {employees.length} of {totalEmployees} employees)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 rounded-lg p-0.5" role="tablist" aria-label="View mode">
            <button
              role="tab"
              aria-selected={activeTab === 'tree'}
              aria-controls="tree-panel"
              onClick={() => setActiveTab('tree')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'tree' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
            >
              <TreePine size={15} /> Tree View
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'list'}
              aria-controls="list-panel"
              onClick={() => setActiveTab('list')}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
            >
              <List size={15} /> List View
            </button>
          </div>
          {canEdit && activeTab === 'tree' && (
            <button onClick={() => { setEditMode(!editMode); setSelectedNodeId(null); }}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                editMode ? 'bg-red-50 text-red-600 border-red-200' : '')}
              style={!editMode ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)', borderColor: 'var(--ui-border-color)' } : undefined}>
              {editMode ? <><X size={15} /> Exit Edit</> : <><Pencil size={15} /> Edit Structure</>}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="layer-card p-12 text-center">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--primary-color)', borderTopColor: 'transparent' }} />
          <p className="text-sm text-gray-500 mt-3">Loading organization chart...</p>
        </div>
      ) : isError ? (
        <div className="layer-card p-16 text-center">
          <Network size={48} className="mx-auto text-red-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">Failed to load org chart</h3>
          <p className="text-sm text-gray-400 mt-1">
            {(error as { data?: { error?: { message?: string } } })?.data?.error?.message || 'An unexpected error occurred'}
          </p>
        </div>
      ) : employees.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Network size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600">No employees found</h3>
        </div>
      ) : activeTab === 'tree' ? (
        <div className="flex gap-4" id="tree-panel" role="tabpanel" aria-label="Tree view">
          {/* Tree View */}
          <div className={cn('layer-card relative overflow-hidden rounded-xl flex-1 transition-all')}>
            {editMode && (
              <div className="absolute top-3 left-3 z-10 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-lg" role="status">
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
                <MiniMap position="bottom-right" nodeColor={miniMapNodeColor} />
              </ReactFlow>
            </div>
          </div>

          {/* Right Panel: Selected Node Details */}
          <AnimatePresence>
            {selectedNodeId && selectedEmployee && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: DETAIL_PANEL_WIDTH, opacity: 1 }}
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
        <div className="layer-card p-6" id="list-panel" role="tabpanel" aria-label="List view">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <label className="sr-only" htmlFor="search-org-employees">Search employees</label>
            <input
              id="search-org-employees"
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="overflow-x-auto" role="tree" aria-label="Organization hierarchy">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Confirm manager reassignment">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-display font-semibold text-gray-900 mb-2">Reassign Manager</h3>
            <p className="text-sm text-gray-600 mb-5">
              Move <span className="font-semibold">{pendingReassign.nodeName}</span> under{' '}
              <span className="font-semibold">{pendingReassign.targetName}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={cancelReassign} disabled={isReassigning}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmReassign} disabled={isReassigning}
                className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg disabled:opacity-50"
                style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
                {isReassigning ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {isReassigning ? 'Saving...' : 'Confirm'}
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
