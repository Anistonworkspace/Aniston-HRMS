declare module 'dagre' {
  export namespace graphlib {
    class Graph {
      constructor(opts?: { directed?: boolean; multigraph?: boolean; compound?: boolean });
      setDefaultEdgeLabel(labelFn: () => Record<string, unknown>): void;
      setGraph(label: Record<string, unknown>): void;
      setNode(id: string, label: Record<string, unknown>): void;
      setEdge(source: string, target: string, label?: Record<string, unknown>): void;
      node(id: string): { x: number; y: number; width: number; height: number };
    }
  }

  export function layout(graph: graphlib.Graph): void;
}
