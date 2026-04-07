// ---------- Org Chart Types ----------

export interface OrgEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  avatar?: string | null;
  manager?: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  managerId?: string | null;
  user?: { id: string; role: string } | null;
}

export interface TreeNode extends OrgEmployee {
  children: TreeNode[];
}

export interface EmployeeNodeData {
  name: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: string;
  employeeCode: string;
  role: string;
  avatar?: string | null;
  isSelected?: boolean;
}

export interface PendingReassign {
  nodeId: string;
  nodeName: string;
  targetId: string;
  targetName: string;
}
