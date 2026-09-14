type WikiTreeNode = { name: string; path: string; file: boolean; children: WikiTreeNode[] };

self.onmessage = (event: MessageEvent<{ paths: string[] }>) => {
  const roots: WikiTreeNode[] = [];
  const indexes = new Map<WikiTreeNode[], Map<string, WikiTreeNode>>([[roots, new Map()]]);
  for (const path of event.data.paths) {
    const parts = path.split("/").filter(Boolean);
    let nodes = roots;
    let index = indexes.get(nodes)!;
    let parent = "";
    parts.forEach((name, position) => {
      const nodePath = parent ? `${parent}/${name}` : name;
      let node = index.get(name);
      if (!node) {
        node = { name, path: nodePath, file: position === parts.length - 1, children: [] };
        nodes.push(node);
        index.set(name, node);
        indexes.set(node.children, new Map());
      }
      parent = nodePath;
      nodes = node.children;
      index = indexes.get(nodes)!;
    });
  }
  const sort = (nodes: WikiTreeNode[]) => {
    nodes.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  self.postMessage(roots);
};
