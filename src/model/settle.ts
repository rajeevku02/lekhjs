// The headless settle (spec 10 §3: `BoardSession.layoutAll` replaces the C++ projector's NoOp
// settle draw): lays out what is dirty on a page, so connector routes, label centres and edge
// anchors exist for a read, a lint or a render, while `serialize` keeps writing the board as it was
// loaded (AC-BE-08). The C++ projector snapshotted what its draw wrote and restored it afterwards;
// here the snapshot covers the connectors (their re-derived automatic params, migrated legacy
// labels and cleared fill); arrowheads are restyled on a drawn copy and never need it.
import type { ConnectionObject, ConnectorSettleState } from './connection/connection-object';
import { isConnector } from './kinds';
import type { ObjectStore } from './object-store';

/** Lays out every dirty object of `store` and keeps its serialized state; returns how many were laid out. */
export function settleLayout(store: ObjectStore): number {
  // Connectors live at page level only (a group holds templated members).
  const connectors = store.objects.filter(isConnector) as ConnectionObject[];
  const saved: ConnectorSettleState[] = connectors.map((c) => c.settleSnapshot());
  const laidOut = store.flushLayout();
  connectors.forEach((c, i) => {
    c.restoreSettle(saved[i] as ConnectorSettleState);
  });
  return laidOut;
}
