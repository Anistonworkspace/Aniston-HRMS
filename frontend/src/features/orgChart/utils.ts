// ---------- Org Chart Utility Functions ----------
import dagre from 'dagre';
import { Position, MarkerType, type Node, type Edge } from '@xyflow/react';
import type { OrgEmployee, TreeNode, EmployeeNodeData } from './types';
import { NODE_WIDTH, NODE_HEIGHT, DAGRE_RANK_SEP, DAGRE_NODE_SEP } from './constants';

// ---------- Dagre Layout ----------
export function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: DAGRE_RANK_SEP, nodesep: DAGRE_NODE_SEP });
  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  dagre.layout(g);
  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      return { ...node, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
    }),
    edges,
  };
}

// ---------- Build ReactFlow Data ----------
export function buildFlowData(employees: OrgEmployee[], selectedId: string | null) {
  const nodes: Node<EmployeeNodeData>[] = employees.map((emp) => ({
    id: emp.id,
    type: 'employee',
    data: {
      name: `${emp.firstName} ${emp.lastName}`,
      firstName: emp.firstName,
      lastName: emp.lastName,
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
      const mgrId = (emp.managerId || emp.manager?.id)!;
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

// ---------- Circular Reference Check ----------
export function wouldCreateCycle(employees: OrgEmployee[], sourceId: string, targetManagerId: string): boolean {
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

// ---------- Build Tree for List View ----------
export function buildTree(employees: OrgEmployee[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  employees.forEach((emp) => map.set(emp.id, { ...emp, children: [] }));
  employees.forEach((emp) => {
    const node = map.get(emp.id)!;
    const mgrId = emp.managerId || emp.manager?.id;
    if (mgrId && map.has(mgrId)) {
      map.get(mgrId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

