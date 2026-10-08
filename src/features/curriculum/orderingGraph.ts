export type OrderingNode = {
  id: string;
  officialSort: number;
  difficulty?: number;
  name?: string;
};

export type OrderingEdge = {
  topicId: string;
  dependsOnId: string;
  type: 'hard_prerequisite' | 'soft_prerequisite' | 'recommended_before' | 'related';
};

export function wouldCreateHardCycle(nodes: OrderingNode[], edges: OrderingEdge[], topicId: string, dependsOnId: string) {
  if (topicId === dependsOnId) return true;
  const hard = new Map<string, string[]>();
  for (const node of nodes) hard.set(node.id, []);
  for (const edge of edges) {
    if (edge.type !== 'hard_prerequisite') continue;
    const list = hard.get(edge.dependsOnId) ?? [];
    list.push(edge.topicId);
    hard.set(edge.dependsOnId, list);
  }
  const walk = [topicId];
  const seen = new Set<string>();
  while (walk.length) {
    const node = walk.pop()!;
    if (node === dependsOnId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    walk.push(...(hard.get(node) ?? []));
  }
  return false;
}

/** Stable Kahn: hard edges first, official sort as tie-break. */
export function stableRecommendedOrder(nodes: OrderingNode[], edges: OrderingEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const hardAdj = new Map<string, string[]>();
  const softReady = new Map<string, string[]>();
  for (const node of nodes) {
    hardAdj.set(node.id, []);
    softReady.set(node.id, []);
  }
  for (const edge of edges) {
    if (!byId.has(edge.topicId) || !byId.has(edge.dependsOnId)) continue;
    if (edge.type === 'hard_prerequisite') {
      hardAdj.get(edge.dependsOnId)!.push(edge.topicId);
      indegree.set(edge.topicId, (indegree.get(edge.topicId) ?? 0) + 1);
    } else if (edge.type === 'soft_prerequisite' || edge.type === 'recommended_before') {
      softReady.get(edge.dependsOnId)!.push(edge.topicId);
    }
  }

  const placed: string[] = [];
  const remaining = new Set(nodes.map((node) => node.id));
  const rankKey = (id: string) => {
    const node = byId.get(id)!;
    return [node.officialSort, node.difficulty ?? 3, node.name ?? '', id] as const;
  };
  const cmp = (a: string, b: string) => {
    const left = rankKey(a);
    const right = rankKey(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] < right[i]) return -1;
      if (left[i] > right[i]) return 1;
    }
    return 0;
  };

  while (remaining.size) {
    const ready = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0).sort(cmp);
    const pick = ready.find((id) => {
      const blockers = [...remaining].filter((other) => {
        if ((indegree.get(other) ?? 0) !== 0) return false;
        return (softReady.get(other) ?? []).includes(id);
      });
      return blockers.length === 0;
    }) ?? ready[0];
    if (!pick) {
      placed.push(...[...remaining].sort(cmp));
      break;
    }
    remaining.delete(pick);
    placed.push(pick);
    for (const next of hardAdj.get(pick) ?? []) {
      indegree.set(next, Math.max(0, (indegree.get(next) ?? 1) - 1));
    }
  }
  return placed;
}
