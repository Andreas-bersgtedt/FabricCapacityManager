import { useMemo } from "react";
import type { EnrichedWorkspace } from "../types";

interface Props {
  workspaces: EnrichedWorkspace[];
}

interface GroupNode {
  key: string;
  label: string;
  count: number;
  children?: GroupNode[];
  workspaces?: EnrichedWorkspace[];
}

/** Groups workspaces by Region -> Capacity SKU -> Capacity Name. */
function buildGroups(workspaces: EnrichedWorkspace[]): GroupNode[] {
  const byRegion = new Map<string, EnrichedWorkspace[]>();
  for (const ws of workspaces) {
    const arr = byRegion.get(ws.region) ?? [];
    arr.push(ws);
    byRegion.set(ws.region, arr);
  }

  const regionNodes: GroupNode[] = [];
  for (const [region, regionWs] of [...byRegion].sort(sortByKey)) {
    const bySku = new Map<string, EnrichedWorkspace[]>();
    for (const ws of regionWs) {
      const arr = bySku.get(ws.sku) ?? [];
      arr.push(ws);
      bySku.set(ws.sku, arr);
    }

    const skuNodes: GroupNode[] = [];
    for (const [sku, skuWs] of [...bySku].sort(sortByKey)) {
      const byCapacity = new Map<string, EnrichedWorkspace[]>();
      for (const ws of skuWs) {
        const arr = byCapacity.get(ws.capacityName) ?? [];
        arr.push(ws);
        byCapacity.set(ws.capacityName, arr);
      }

      const capacityNodes: GroupNode[] = [...byCapacity]
        .sort(sortByKey)
        .map(([capacityName, capWs]) => ({
          key: `${region}|${sku}|${capacityName}`,
          label: capacityName,
          count: capWs.length,
          workspaces: capWs.sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        }));

      skuNodes.push({
        key: `${region}|${sku}`,
        label: sku,
        count: skuWs.length,
        children: capacityNodes,
      });
    }

    regionNodes.push({
      key: region,
      label: region,
      count: regionWs.length,
      children: skuNodes,
    });
  }
  return regionNodes;
}

function sortByKey(
  a: [string, unknown],
  b: [string, unknown],
): number {
  return a[0].localeCompare(b[0]);
}

function StorageBadge({ mode }: { mode: EnrichedWorkspace["storageMode"] }) {
  return <span className={`badge storage-${mode.toLowerCase()}`}>{mode}</span>;
}

export function WorkspaceTree({ workspaces }: Props) {
  const groups = useMemo(() => buildGroups(workspaces), [workspaces]);

  if (workspaces.length === 0) {
    return <p className="muted">No workspaces match the current filters.</p>;
  }

  return (
    <div className="tree">
      {groups.map((region) => (
        <details key={region.key} className="region" open>
          <summary>
            <span className="group-icon">🌍</span>
            <span className="group-title">{region.label}</span>
            <span className="count">{region.count}</span>
          </summary>
          {region.children?.map((sku) => (
            <details key={sku.key} className="sku" open>
              <summary>
                <span className="group-icon">🏷️</span>
                <span className="group-title">SKU: {sku.label}</span>
                <span className="count">{sku.count}</span>
              </summary>
              {sku.children?.map((capacity) => (
                <details key={capacity.key} className="capacity" open>
                  <summary>
                    <span className="group-icon">⚡</span>
                    <span className="group-title">{capacity.label}</span>
                    <span className="count">{capacity.count}</span>
                  </summary>
                  <table className="ws-table">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Storage</th>
                        <th>Items</th>
                        <th>Item types</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacity.workspaces?.map((ws) => (
                        <tr key={ws.id}>
                          <td>
                            <a
                              href={`https://app.fabric.microsoft.com/groups/${ws.id}/list`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ws.displayName}
                            </a>
                          </td>
                          <td>
                            <StorageBadge mode={ws.storageMode} />
                          </td>
                          <td>{ws.itemCount}</td>
                          <td className="item-types">
                            {ws.itemTypes.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              ws.itemTypes.map((t) => (
                                <span key={t} className="chip">
                                  {t}
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}
