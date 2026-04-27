const decisionTreeData = {
  nodes: [],
  edges: [],
};

const ONTOLOGY_EXAMPLES = {
  hospital: {
    folder: 'HospitalOntology',
    label: 'Hospital Ontology',
  },
  pizza: {
    folder: 'PizzaOntology',
    label: 'Pizza Ontology',
  },
};

const nodeInfoCache = new Map();

const impactCache = {
  probabilities: new Map(),
  classHierarchy: new Map(),
  hammingDistance: new Map(),
};

export function getActiveOntologyExample() {
  const params = new URLSearchParams(window.location.search);
  const exampleId = params.get('example') || 'hospital';
  return ONTOLOGY_EXAMPLES[exampleId] || ONTOLOGY_EXAMPLES.hospital;
}

function getActiveOntologyBasePath() {
  return `/${getActiveOntologyExample().folder}`;
}

async function fetchCachedJson(cache, cacheKey, url, errorMessage) {
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(errorMessage);
  }

  const payload = await response.json();
  cache.set(cacheKey, payload);
  return payload;
}

function linkChildNode(parentNodeId, childNodeId, edgeType) {
  decisionTreeData.edges.push({
    id: `edge-${parentNodeId}-${edgeType}`,
    source: parentNodeId,
    target: childNodeId,
    label: edgeType,
    type: edgeType,
  });

  const childNode = decisionTreeData.nodes.find(n => n.id === childNodeId);
  if (childNode) {
    childNode.parent = parentNodeId;
  }
}

export async function initializeDecisionTree() {
  try {
    const treeResponse = await fetch(`${getActiveOntologyBasePath()}/DecisionTreeResponse/decision_tree.json`);
    const treeNodes = await treeResponse.json();

    decisionTreeData.nodes = treeNodes.map(node => ({
      id: `node-${node.nodeId}`,
      label: node.axiomStr || `Leaf Node ${node.nodeId}`,
      axiom: node.axiomStr,
      nodeId: node.nodeId,
      parent: null,
      children: [],
    }));

    treeNodes.forEach(node => {
      if (node.yes !== undefined && node.yes !== null) {
        linkChildNode(`node-${node.nodeId}`, `node-${node.yes}`, 'keep');
      }

      if (node.no !== undefined && node.no !== null) {
        linkChildNode(`node-${node.nodeId}`, `node-${node.no}`, 'remove');
      }
    });

    return decisionTreeData;
  } catch (error) {
    console.error('Error loading decision tree data:', error);
    throw error;
  }
}

export async function getImpactProbabilities(nodeId) {
  try {
    return await fetchCachedJson(
      impactCache.probabilities,
      nodeId,
      `${getActiveOntologyBasePath()}/Impact1Responses/probabilities_${nodeId}.json`,
      `Failed to fetch probabilities for node ${nodeId}`,
    );
  } catch (error) {
    console.error(`Error loading probabilities for node ${nodeId}:`, error);
    return null;
  }
}
export async function getClassHierarchyDifference(nodeId) {
  try {
    return await fetchCachedJson(
      impactCache.classHierarchy,
      nodeId,
      `${getActiveOntologyBasePath()}/Impact2Responses/classHierarchyDifference_${nodeId}.json`,
      `Failed to fetch class hierarchy for node ${nodeId}`,
    );
  } catch (error) {
    console.error(`Error loading class hierarchy for node ${nodeId}:`, error);
    return null;
  }
}
export async function getHammingDistance(nodeId) {
  try {
    return await fetchCachedJson(
      impactCache.hammingDistance,
      nodeId,
      `${getActiveOntologyBasePath()}/Impact3Responses/hammingDistance_${nodeId}.json`,
      `Failed to fetch hamming distance for node ${nodeId}`,
    );
  } catch (error) {
    console.error(`Error loading hamming distance for node ${nodeId}:`, error);
    return null;
  }
}
export async function getNodeImpact(nodeId) {
  try {
    const [
      probabilities,
      hierarchy,
      distance,
    ] = await Promise.all([
      getImpactProbabilities(nodeId),
      getClassHierarchyDifference(nodeId),
      getHammingDistance(nodeId),
    ]);

    return {
      nodeId,
      probabilities,
      classHierarchy: hierarchy,
      hammingDistance: distance,
    };
  } catch (error) {
    console.error(`Error loading impact data for node ${nodeId}:`, error);
    return null;
  }
}
export function getDecisionTree() {
  return decisionTreeData;
}
export function getNextNodes(nodeId) {
  const edges = decisionTreeData.edges.filter(
    edge => edge.source === `node-${nodeId}`,
  );

  return edges.map(edge => ({
    target: edge.target,
    label: edge.label,
    type: edge.type,
  }));
}
export function getChildNodes(nodeId) {
  const children = decisionTreeData.nodes.filter(
    node => node.parent === `node-${nodeId}`,
  );
  return children;
}
export function getParentNode(nodeId) {
  const node = decisionTreeData.nodes.find(n => n.id === `node-${nodeId}`);
  if (node && node.parent) {
    return decisionTreeData.nodes.find(n => n.id === node.parent);
  }
  return null;
}

export default {
  initializeDecisionTree,
  getImpactProbabilities,
  getClassHierarchyDifference,
  getHammingDistance,
  getNodeImpact,
  getDecisionTree,
  getNextNodes,
  getChildNodes,
  getParentNode,
  getActiveOntologyExample,
};
