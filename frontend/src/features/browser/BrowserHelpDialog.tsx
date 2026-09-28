import Modal from "../../components/Modal";
import type { BrowserActionState } from "./browserActions";

export default function BrowserHelpDialog({ actions, onClose }: { actions: BrowserActionState[]; onClose: () => void }) {
  const unavailable = actions.filter((action, index) => action.visible && !action.enabled && actions.findIndex((other) => other.id === action.id) === index);
  return <Modal title="Browser help" onClose={onClose}>
    <p className="mb-3 ui-body">Commands follow the current selection, workspace and storage permissions.</p>
    <h3 className="ui-subtitle">Unavailable actions</h3>
    {unavailable.length ? <dl className="mb-4 space-y-2">{unavailable.map((action) => <div key={action.id}>
      <dt className="font-medium">{action.label}</dt><dd className="ui-caption">{action.disabledReason || "Unavailable in the current context."}</dd>
    </div>)}</dl> : <p className="mb-4 ui-caption">All visible commands are available.</p>}
    <h3 className="ui-subtitle">Keyboard shortcuts</h3>
    <dl className="space-y-2 ui-caption">
      <div><dt>Ctrl / ⌘ + A</dt><dd>Select loaded items</dd></div>
      <div><dt>Ctrl / ⌘ + L</dt><dd>Edit the current path</dd></div>
      <div><dt>Ctrl / ⌘ + C, X, V</dt><dd>Copy, cut and paste when allowed</dd></div>
      <div><dt>↑ / ↓, Home / End</dt><dd>Navigate rows; hold Shift to extend the selection</dd></div>
      <div><dt>Space / Enter / Escape</dt><dd>Toggle selection / open / clear selection</dd></div>
    </dl>
  </Modal>;
}
